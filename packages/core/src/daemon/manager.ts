import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as child_process from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DaemonManagerOptions,
  DaemonStartResult,
  DaemonStatus,
  DaemonStopResult,
  ProcessChecker,
  ProcessKiller
} from './types.js';
import {
  formatUptime,
  getChildProcessIds,
  getDefaultProcessChecker,
  getDefaultProcessKiller,
  isTokenPalWatcherCommand,
  readPidFile,
  readPidFileInfo,
  removePidFile,
  writePidFileAtomic,
  DAEMON_FLAG_MARKER
} from './pid.js';

export const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Resolves the default absolute path to the CLI entry point dist/index.js.
 */
export function resolveDefaultCliPath(): string {
  if (process.argv[1] && fs.existsSync(process.argv[1])) {
    try {
      const real = fs.realpathSync(process.argv[1]);
      if (real.endsWith('.js') || isTokenPalWatcherCommand(real)) {
        return real;
      }
    } catch {
      // ignore
    }
  }

  const currentDir = typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

  const possiblePaths = [
    path.resolve(currentDir, '../../../cli/dist/index.js'),
    path.resolve(currentDir, '../../cli/dist/index.js'),
    path.resolve(process.cwd(), 'packages/cli/dist/index.js')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return possiblePaths[0];
}

export class DaemonManager {
  private rootDir: string;
  private pidFile: string;
  private logFile: string;
  private rotatedLogFile: string;
  private cliPath: string;
  private processChecker: ProcessChecker;
  private processKiller: ProcessKiller;
  private childProcessFinder: (pid: number) => number[];
  private onStalePid?: (pid: number, reason: string) => void;

  constructor(options: DaemonManagerOptions = {}) {
    this.rootDir = options.rootDir || path.join(os.homedir(), '.tokenpal');
    this.pidFile = options.pidFile || path.join(this.rootDir, 'tokenpal.pid');
    this.logFile = options.logFile || path.join(this.rootDir, 'tokenpal.log');
    this.rotatedLogFile = options.rotatedLogFile || path.join(this.rootDir, 'tokenpal.log.1');
    this.cliPath = options.cliPath || resolveDefaultCliPath();
    this.processChecker = options.processChecker || getDefaultProcessChecker();
    this.processKiller = options.processKiller || getDefaultProcessKiller();
    this.childProcessFinder = options.childProcessFinder || getChildProcessIds;
    this.onStalePid = options.onStalePid;

    // Ensure root directory exists
    if (!fs.existsSync(this.rootDir)) {
      try {
        fs.mkdirSync(this.rootDir, { recursive: true });
      } catch {
        // ignore
      }
    }
  }

  public getPidFilePath(): string {
    return this.pidFile;
  }

  public getLogFilePath(): string {
    return this.logFile;
  }

  public getRotatedLogFilePath(): string {
    return this.rotatedLogFile;
  }


  /**
   * Safely inspects the daemon status.
   * If a PID file exists, verifies that the process exists AND that its command line
   * corresponds to TokenPal's watcher. If stale or reused, removes the PID file.
   */
  public getStatus(): DaemonStatus {
    const pidInfo = readPidFileInfo(this.pidFile);
    if (!pidInfo) {
      return { running: false };
    }

    const { pid, marker } = pidInfo;
    const info = this.processChecker(pid);

    // 1. Process does not exist
    if (!info.running) {
      removePidFile(this.pidFile);
      this.onStalePid?.(pid, 'process does not exist');
      return { running: false, stalePidCleaned: pid };
    }

    // 2. Process exists, check if command line matches TokenPal
    if (marker) {
      // Tightened check: require the unique marker (e.g. '--tokenpal-daemon') in command
      const hasMarker = info.command ? info.command.includes(marker) : false;
      if (!hasMarker) {
        removePidFile(this.pidFile);
        this.onStalePid?.(pid, `pid reused by another command (${info.command || 'unknown'})`);
        return { running: false, stalePidCleaned: pid };
      }
    } else {
      // Fallback only for PIDs written by the previous version without a marker
      if (!isTokenPalWatcherCommand(info.command)) {
        removePidFile(this.pidFile);
        this.onStalePid?.(pid, `pid reused by another command (${info.command || 'unknown'})`);
        return { running: false, stalePidCleaned: pid };
      }
    }

    // 3. Valid active TokenPal watcher daemon
    return {
      running: true,
      pid,
      uptimeSec: info.uptimeSec,
      uptimeFormatted: info.uptimeSec !== undefined ? formatUptime(info.uptimeSec) : undefined
    };
  }

  /**
   * Starts the watcher.
   * If foreground: writes PID file and runs in-terminal.
   * If background (default): runs as a detached process with stdio redirected to logFile.
   */
  public async start(options: {
    foreground?: boolean;
    ui?: boolean;
    watchDir?: string;
    dbPath?: string;
    configPath?: string;
    legacyRules?: boolean;
    waitAliveMs?: number;
  } = {}): Promise<DaemonStartResult> {
    const status = this.getStatus();
    if (status.running) {
      return {
        started: false,
        alreadyRunning: true,
        pid: status.pid
      };
    }

    // Rotate log file if needed before starting
    this.rotateLogs(DEFAULT_LOG_MAX_BYTES);

    if (options.foreground) {
      // In foreground mode, the current process acts as the watcher
      writePidFileAtomic(this.pidFile, process.pid, DAEMON_FLAG_MARKER);
      return { started: true, pid: process.pid };
    }

    // Background daemon mode
    let outFd: number | null = null;
    try {
      outFd = fs.openSync(this.logFile, 'a');
    } catch (err: any) {
      return { started: false, error: `Failed to open log file ${this.logFile}: ${err.message}` };
    }

    const args = [this.cliPath, 'watch', DAEMON_FLAG_MARKER];
    if (options.ui !== false) args.push('--ui');
    if (options.watchDir) args.push('--dir', options.watchDir);
    if (options.dbPath) args.push('--db', options.dbPath);
    if (options.configPath) args.push('--config', options.configPath);
    if (options.legacyRules) args.push('--legacy-rules');

    let child: child_process.ChildProcess;
    try {
      child = child_process.spawn(process.execPath, args, {
        detached: true,
        stdio: ['ignore', outFd, outFd],
        env: {
          ...process.env,
          TOKENPAL_DAEMON: '1'
        }
      });
    } catch (err: any) {
      fs.closeSync(outFd);
      return { started: false, error: `Failed to spawn process: ${err.message}` };
    }

    const childPid = child.pid;
    if (!childPid) {
      fs.closeSync(outFd);
      return { started: false, error: 'Spawn failed to return a valid process ID' };
    }

    // Atomically write PID file with marker
    writePidFileAtomic(this.pidFile, childPid, DAEMON_FLAG_MARKER);

    // Unref child so parent process can exit independently
    child.unref();
    fs.closeSync(outFd);

    // Wait briefly to confirm child process stayed alive
    const waitMs = options.waitAliveMs ?? 600;
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    const check = this.processChecker(childPid);
    if (!check.running) {
      removePidFile(this.pidFile);
      const recentLogs = this.getLogs(10).lines.join('\n');
      return {
        started: false,
        error: `Watcher process exited prematurely (pid ${childPid}). Log output:\n${recentLogs}`
      };
    }

    return { started: true, pid: childPid };
  }

  /**
   * Stops the daemon.
   * Sends SIGTERM, waits up to timeoutMs (default: 5000ms), escalates to SIGKILL if needed.
   * Ensures any child overlay/Electron processes are terminated so no orphans remain.
   */
  public async stop(options: { timeoutMs?: number; pollIntervalMs?: number } = {}): Promise<DaemonStopResult> {
    const status = this.getStatus();
    if (!status.running || !status.pid) {
      return { stopped: false, wasRunning: false };
    }

    const targetPid = status.pid;
    const timeoutMs = options.timeoutMs ?? 5000;
    const pollIntervalMs = options.pollIntervalMs ?? 150;

    // Find any child processes (e.g. Electron overlay, helper processes)
    const childPids = this.childProcessFinder(targetPid);

    // 1. Send SIGTERM to watcher and all descendants
    for (const cp of childPids) {
      this.processKiller(cp, 'SIGTERM');
    }
    this.processKiller(targetPid, 'SIGTERM');

    // Also attempt process group kill if on POSIX
    if (targetPid > 1 && process.platform !== 'win32') {
      try {
        process.kill(-targetPid, 'SIGTERM');
      } catch {
        // ignore if not a group leader
      }
    }

    // 2. Poll until process and all children exit or timeout expires
    const startTime = Date.now();
    let isDead = false;

    while (Date.now() - startTime < timeoutMs) {
      const parentRunning = this.processChecker(targetPid).running;
      const anyChildRunning = childPids.some((cp) => this.processChecker(cp).running);
      if (!parentRunning && !anyChildRunning) {
        isDead = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // 3. Escalate to SIGKILL if still alive after timeout
    let forced = false;
    if (!isDead) {
      forced = true;
      const remainingChildren = this.childProcessFinder(targetPid);
      const allTargets = Array.from(new Set([...childPids, ...remainingChildren]));
      for (const cp of allTargets) {
        if (this.processChecker(cp).running) {
          this.processKiller(cp, 'SIGKILL');
        }
      }
      if (this.processChecker(targetPid).running) {
        this.processKiller(targetPid, 'SIGKILL');
      }

      if (targetPid > 1 && process.platform !== 'win32') {
        try {
          process.kill(-targetPid, 'SIGKILL');
        } catch {
          // ignore
        }
      }
      // Brief grace period for kernel termination
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    removePidFile(this.pidFile);
    return { stopped: true, wasRunning: true, pid: targetPid, forced };
  }

  /**
   * Restarts the daemon (stop then start).
   */
  public async restart(startOptions?: Parameters<DaemonManager['start']>[0]): Promise<{
    stopped: DaemonStopResult;
    started: DaemonStartResult;
  }> {
    const stopped = await this.stop();
    const started = await this.start(startOptions);
    return { stopped, started };
  }

  /**
   * Returns the last N lines of the log file.
   */
  public getLogs(linesCount = 50): { lines: string[]; totalLines: number; logPath: string } {
    if (!fs.existsSync(this.logFile)) {
      return { lines: [], totalLines: 0, logPath: this.logFile };
    }
    try {
      const content = fs.readFileSync(this.logFile, 'utf-8');
      const allLines = content.split('\n');
      // If trailing empty line from ending newline, remove it
      if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
        allLines.pop();
      }
      const sliceStart = Math.max(0, allLines.length - linesCount);
      const lines = allLines.slice(sliceStart);
      return { lines, totalLines: allLines.length, logPath: this.logFile };
    } catch {
      return { lines: [], totalLines: 0, logPath: this.logFile };
    }
  }

  /**
   * Rotates logFile to rotatedLogFile if file size reaches or exceeds maxSizeBytes (default: 5 MB).
   */
  public rotateLogs(maxSizeBytes: number = DEFAULT_LOG_MAX_BYTES): boolean {
    if (!fs.existsSync(this.logFile)) {
      return false;
    }
    try {
      const stats = fs.statSync(this.logFile);
      if (stats.size >= maxSizeBytes) {
        if (fs.existsSync(this.rotatedLogFile)) {
          try {
            fs.unlinkSync(this.rotatedLogFile);
          } catch {
            // ignore
          }
        }
        // Copy to rotated log file and truncate current log file so open file descriptors remain valid
        fs.copyFileSync(this.logFile, this.rotatedLogFile);
        fs.truncateSync(this.logFile, 0);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  /**
   * Removes PID file if it matches the calling process's PID.
   * Called during graceful exit of the watcher process.
   */
  public cleanupPidOnExit(): void {
    const pid = readPidFile(this.pidFile);
    if (pid === process.pid) {
      removePidFile(this.pidFile);
    }
  }
}
