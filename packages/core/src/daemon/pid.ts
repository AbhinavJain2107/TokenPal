import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import { ProcessChecker, ProcessInfo, ProcessKiller } from './types.js';

/**
 * Atomically writes a PID file by first writing to a unique temp file in the same
 * directory and then renaming it.
 */
export function writePidFileAtomic(pidPath: string, pid: number): void {
  const dir = path.dirname(pidPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = path.join(dir, `.tokenpal.pid.tmp.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tempPath, `${pid}\n`, 'utf-8');
  fs.renameSync(tempPath, pidPath);
}

/**
 * Reads the PID from a file. Returns null if missing or invalid.
 */
export function readPidFile(pidPath: string): number | null {
  if (!fs.existsSync(pidPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(content, 10);
    if (isNaN(pid) || pid <= 0) {
      removePidFile(pidPath);
      return null;
    }
    return pid;
  } catch {
    return null;
  }
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
 * Guards against PID reuse by other applications after a crash or reboot.
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
    lower.includes('dist/index.js') ||
    lower.includes('bin/tokenpal');
  return hasTokenPal && hasWatcherAction;
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

    // 2. Inspect command line and uptime via ps
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
