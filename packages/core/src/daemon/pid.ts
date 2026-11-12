import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import { ProcessChecker, ProcessInfo, ProcessKiller } from './types.js';

/**
 * Atomically writes a PID file by first writing to a unique temp file in the same
 * directory and then renaming it.
 */
export const DAEMON_FLAG_MARKER = '--tokenpal-daemon';

export interface PidFileInfo {
  pid: number;
  marker?: string;
}

/**
 * Atomically writes a PID file by first writing to a unique temp file in the same
 * directory and then renaming it. Supports optional unique daemon marker line.
 */
export function writePidFileAtomic(pidPath: string, pid: number, marker?: string): void {
  const dir = path.dirname(pidPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = path.join(dir, `.tokenpal.pid.tmp.${process.pid}.${Date.now()}`);
  const content = marker ? `${pid}\n${marker}\n` : `${pid}\n`;
  fs.writeFileSync(tempPath, content, 'utf-8');
  fs.renameSync(tempPath, pidPath);
}

/**
 * Reads detailed PID file information (PID and optional daemon marker).
 */
export function readPidFileInfo(pidPath: string): PidFileInfo | null {
  if (!fs.existsSync(pidPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(pidPath, 'utf-8');
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      removePidFile(pidPath);
      return null;
    }
    const pid = parseInt(lines[0], 10);
    if (isNaN(pid) || pid <= 0) {
      removePidFile(pidPath);
      return null;
    }
    const marker = lines.length > 1 ? lines[1] : undefined;
    return { pid, marker };
  } catch {
    return null;
  }
}

/**
 * Reads the PID from a file. Returns null if missing or invalid.
 */
export function readPidFile(pidPath: string): number | null {
  const info = readPidFileInfo(pidPath);
  return info ? info.pid : null;
}

/**
 * Removes a PID file safely if it exists.
 */
export function removePidFile(pidPath: string): boolean {
  if (fs.existsSync(pidPath)) {
    try {
      fs.unlinkSync(pidPath);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Checks whether a command string matches TokenPal's watcher.
 * Used as a fallback check for PID files written by the previous version without a marker.
 * Strictly excludes other tokenpal commands such as 'tokenpal logs', 'tokenpal status', etc.
 */
export function isTokenPalWatcherCommand(command?: string): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  const hasTokenPal =
    lower.includes('tokenpal') ||
    lower.includes('@tokenpal/cli') ||
    lower.includes('packages/cli');
  const hasWatcherAction =
    lower.includes('watch') ||
    lower.includes('start') ||
    lower.includes('--tokenpal-daemon');
  // Exclude other CLI subcommands like 'tokenpal logs', 'tokenpal status', 'tokenpal handoff'
  const isOtherSubcommand = /(?:tokenpal|index\.js)\s+(?:logs|status|handoff|demo|replay|autostart)(?:\s|$)/i.test(command);
  return hasTokenPal && hasWatcherAction && !isOtherSubcommand;
}

/**
 * Formats an elapsed duration in seconds to a human-readable string.
 * Example: '15s', '4m 12s', '2h 15m', '3d 5h'
 */
export function formatUptime(uptimeSec: number): string {
  if (uptimeSec < 60) {
    return `${Math.max(0, Math.floor(uptimeSec))}s`;
  }
  const mins = Math.floor(uptimeSec / 60);
  const secs = Math.floor(uptimeSec % 60);
  if (mins < 60) {
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  if (hours < 24) {
    return `${hours}h ${remainingMins}m`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d ${remainingHours}h`;
}

/**
 * Parses elapsed time from macOS / POSIX ps output (e.g., '12:34' or '01:23:45' or '2-03:45:10').
 */
export function parseEtimeToSeconds(etimeStr: string): number {
  const trimmed = etimeStr.trim();
  if (!trimmed) return 0;

  let days = 0;
  let timePart = trimmed;
  if (trimmed.includes('-')) {
    const [dayStr, rest] = trimmed.split('-');
    days = parseInt(dayStr, 10) || 0;
    timePart = rest;
  }

  const parts = timePart.split(':').map((p) => parseInt(p, 10) || 0);
  if (parts.length === 2) {
    // mm:ss
    return days * 86400 + parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    // hh:mm:ss
    return days * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

/**
 * Default platform process checker inspecting liveness, command line, and uptime.
 */
export function getDefaultProcessChecker(): ProcessChecker {
  return (pid: number): ProcessInfo => {
    try {
      // 1. Liveness check via signal 0
      process.kill(pid, 0);
    } catch (err: any) {
      if (err.code === 'ESRCH') {
        return { running: false };
      }
      // EPERM means process exists but we don't own it
    }

    // Windows inspection via PowerShell CIM
    if (process.platform === 'win32') {
      try {
        const output = child_process.execSync(
          `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process -Filter \\"ProcessId = ${pid}\\" | Select-Object -ExpandProperty CommandLine"`,
          {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 2000
          }
        ).trim();

        return {
          running: true,
          command: output || undefined
        };
      } catch {
        return { running: true };
      }
    }

    // 2. Inspect command line and uptime via ps (macOS / Linux)
    try {
      const output = child_process.execSync(`ps -p ${pid} -o etime=,command=`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000
      }).trim();

      if (!output) {
        return { running: false };
      }

      // First token is etime, remainder is command
      const firstSpace = output.indexOf(' ');
      let etime = '';
      let command = output;
      if (firstSpace !== -1) {
        etime = output.slice(0, firstSpace).trim();
        command = output.slice(firstSpace + 1).trim();
      }

      const uptimeSec = etime ? parseEtimeToSeconds(etime) : undefined;
      return {
        running: true,
        command,
        uptimeSec
      };
    } catch {
      // If ps failed or process exited during inspection
      return { running: false };
    }
  };
}

/**
 * Default process killer using Node process.kill.
 */
export function getDefaultProcessKiller(): ProcessKiller {
  return (pid: number, signal: NodeJS.Signals): void => {
    if (process.platform === 'win32' && (signal === 'SIGKILL' || signal === 'SIGTERM')) {
      try {
        child_process.execSync(`taskkill /F /T /PID ${pid}`, { stdio: ['ignore', 'ignore', 'ignore'] });
        return;
      } catch {
        // fallback to process.kill
      }
    }
    try {
      process.kill(pid, signal);
    } catch {
      // ignore if process already exited
    }
  };
}

/**
 * Recursively finds all descendant process IDs of a given parent PID.
 */
export function getChildProcessIds(parentPid: number): number[] {
  if (parentPid <= 0) return [];

  if (process.platform === 'win32') {
    try {
      const output = child_process.execSync(
        `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process -Filter \\"ParentProcessId = ${parentPid}\\" | Select-Object -ExpandProperty ProcessId"`,
        {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2000
        }
      );
      const pids = output
        .trim()
        .split(/\s+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => !isNaN(n) && n > 0);

      const allPids = [...pids];
      for (const p of pids) {
        allPids.push(...getChildProcessIds(p));
      }
      return allPids;
    } catch {
      return [];
    }
  }

  try {
    const output = child_process.execSync(`pgrep -P ${parentPid}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000
    });
    const pids = output
      .trim()
      .split(/\s+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n) && n > 0);

    const allPids = [...pids];
    for (const p of pids) {
      allPids.push(...getChildProcessIds(p));
    }
    return allPids;
  } catch {
    return [];
  }
}

/**
 * Finds any running processes whose command line includes the overlay entry point.
 */
export function findOverlayProcesses(): ProcessInfo[] {
  if (process.platform === 'win32') {
    try {
      const output = child_process.execSync(
        `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*overlay*' } | Select-Object ProcessId,CommandLine | ConvertTo-Json"`,
        {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 3000
        }
      );
      const trimmed = output.trim();
      if (!trimmed) return [];
      const parsed = JSON.parse(trimmed);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const matched: ProcessInfo[] = [];
      for (const item of items) {
        const pid = item.ProcessId;
        const command = item.CommandLine || '';
        if (pid === process.pid) continue;
        if (
          command.includes('packages/overlay/dist/main.js') ||
          command.includes('overlay/dist/main.js') ||
          command.includes('packages/overlay/src/main.ts')
        ) {
          matched.push({
            running: true,
            command,
            pid
          });
        }
      }
      return matched;
    } catch {
      return [];
    }
  }

  try {
    const output = child_process.execSync('ps -eo pid,args', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000
    });
    const lines = output.split('\n');
    const matched: ProcessInfo[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^(\d+)\s+(.+)$/);
      if (match) {
        const pid = parseInt(match[1], 10);
        const command = match[2];
        if (pid === process.pid) continue;
        if (
          command.includes('packages/overlay/dist/main.js') ||
          command.includes('overlay/dist/main.js') ||
          command.includes('packages/overlay/src/main.ts')
        ) {
          matched.push({
            running: true,
            command,
            pid
          });
        }
      }
    }
    return matched;
  } catch {
    return [];
  }
}

