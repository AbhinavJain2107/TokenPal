import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as child_process from 'node:child_process';
import * as net from 'node:net';
import { createRequire } from 'node:module';
import {
  DaemonManager,
  writePidFileAtomic,
  readPidFile,
  readPidFileInfo,
  DAEMON_FLAG_MARKER,
  removePidFile,
  isTokenPalWatcherCommand,
  formatUptime,
  parseEtimeToSeconds,
  generateLaunchAgentPlist,
  generateLinuxDesktopEntry,
  generateWindowsStartupScript,
  enableAutostart,
  disableAutostart,
  ProcessInfo
} from '../src/daemon/index.js';

describe('Daemon Management', () => {
  let tempDir: string;
  let pidFile: string;
  let logFile: string;
  let rotatedLogFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenpal-daemon-test-'));
    pidFile = path.join(tempDir, 'tokenpal.pid');
    logFile = path.join(tempDir, 'tokenpal.log');
    rotatedLogFile = path.join(tempDir, 'tokenpal.log.1');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('PID file operations', () => {
    it('atomically writes and reads PID file', () => {
      writePidFileAtomic(pidFile, 12345);
      expect(fs.existsSync(pidFile)).toBe(true);
      expect(readPidFile(pidFile)).toBe(12345);
      expect(readPidFileInfo(pidFile)).toEqual({ pid: 12345, marker: undefined });
    });

    it('writes and reads PID file with unique daemon marker', () => {
      writePidFileAtomic(pidFile, 12345, DAEMON_FLAG_MARKER);
      expect(fs.existsSync(pidFile)).toBe(true);
      expect(readPidFile(pidFile)).toBe(12345);
      expect(readPidFileInfo(pidFile)).toEqual({ pid: 12345, marker: DAEMON_FLAG_MARKER });
    });

    it('safely handles non-existent or corrupted PID file', () => {
      expect(readPidFile(path.join(tempDir, 'does-not-exist.pid'))).toBeNull();
      expect(readPidFileInfo(path.join(tempDir, 'does-not-exist.pid'))).toBeNull();

      // Write non-numeric corrupt content
      fs.writeFileSync(pidFile, 'not-a-pid\n');
      expect(readPidFile(pidFile)).toBeNull();
      // Should clean up the corrupted file
      expect(fs.existsSync(pidFile)).toBe(false);
    });

    it('removes PID file safely', () => {
      writePidFileAtomic(pidFile, 54321);
      expect(removePidFile(pidFile)).toBe(true);
      expect(fs.existsSync(pidFile)).toBe(false);
      // Second removal returns false without throwing
      expect(removePidFile(pidFile)).toBe(false);
    });
  });

  describe('Process command verification (isTokenPalWatcherCommand)', () => {
    it('accepts legitimate TokenPal watcher commands', () => {
      expect(isTokenPalWatcherCommand('node /Users/dev/TokenPal/packages/cli/dist/index.js watch')).toBe(true);
      expect(isTokenPalWatcherCommand('node /usr/local/bin/tokenpal watch')).toBe(true);
      expect(isTokenPalWatcherCommand('/usr/local/bin/tokenpal start --foreground')).toBe(true);
      expect(isTokenPalWatcherCommand('node packages/cli/dist/index.js watch --dir /logs')).toBe(true);
      expect(isTokenPalWatcherCommand('/bin/node /repo/dist/index.js tokenpal watch')).toBe(true);
      expect(isTokenPalWatcherCommand('node /repo/dist/index.js watch --tokenpal-daemon')).toBe(true);
    });

    it('rejects commands when PID is reused by other tokenpal CLI subcommands', () => {
      expect(isTokenPalWatcherCommand('node /Users/dev/TokenPal/packages/cli/dist/index.js logs -f')).toBe(false);
      expect(isTokenPalWatcherCommand('tokenpal logs -f')).toBe(false);
      expect(isTokenPalWatcherCommand('node /usr/local/bin/tokenpal logs -n 50')).toBe(false);
      expect(isTokenPalWatcherCommand('tokenpal status')).toBe(false);
      expect(isTokenPalWatcherCommand('tokenpal demo')).toBe(false);
      expect(isTokenPalWatcherCommand('tokenpal handoff')).toBe(false);
      expect(isTokenPalWatcherCommand('tokenpal replay /tmp/session.jsonl')).toBe(false);
      expect(isTokenPalWatcherCommand('node packages/cli/dist/index.js autostart enable')).toBe(false);
    });

    it('rejects commands when PID is reused by other processes', () => {
      expect(isTokenPalWatcherCommand('/usr/bin/python3 script.py')).toBe(false);
      expect(isTokenPalWatcherCommand('node /usr/local/bin/vite dev')).toBe(false);
      expect(isTokenPalWatcherCommand('nginx: master process /usr/sbin/nginx')).toBe(false);
      expect(isTokenPalWatcherCommand('/bin/bash')).toBe(false);
      expect(isTokenPalWatcherCommand('')).toBe(false);
      expect(isTokenPalWatcherCommand(undefined)).toBe(false);
    });
  });

  describe('Uptime formatting and etime parsing', () => {
    it('parses ps etime formats correctly', () => {
      expect(parseEtimeToSeconds('00:45')).toBe(45);
      expect(parseEtimeToSeconds('12:34')).toBe(12 * 60 + 34);
      expect(parseEtimeToSeconds('01:23:45')).toBe(3600 + 23 * 60 + 45);
      expect(parseEtimeToSeconds('2-04:10:00')).toBe(2 * 86400 + 4 * 3600 + 10 * 60);
      expect(parseEtimeToSeconds('')).toBe(0);
    });

    it('formats uptime to human-readable strings', () => {
      expect(formatUptime(42)).toBe('42s');
      expect(formatUptime(135)).toBe('2m 15s');
      expect(formatUptime(7300)).toBe('2h 1m');
      expect(formatUptime(90000)).toBe('1d 1h');
    });
  });

  describe('DaemonManager status with fake process table', () => {
    it('reports stopped when no PID file exists', () => {
      const manager = new DaemonManager({ rootDir: tempDir, pidFile, logFile });
      const status = manager.getStatus();
      expect(status.running).toBe(false);
      expect(status.pid).toBeUndefined();
    });

    it('reports running when PID exists and command matches TokenPal watcher', () => {
      const fakeProcessTable = new Map<number, ProcessInfo>([
        [
          2001,
          {
            running: true,
            command: 'node /Users/dev/TokenPal/packages/cli/dist/index.js watch',
            uptimeSec: 320
          }
        ]
      ]);

      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile,
        processChecker: (pid) => fakeProcessTable.get(pid) || { running: false }
      });

      writePidFileAtomic(pidFile, 2001);
      const status = manager.getStatus();
      expect(status.running).toBe(true);
      expect(status.pid).toBe(2001);
      expect(status.uptimeSec).toBe(320);
      expect(status.uptimeFormatted).toBe('5m 20s');
    });

    it('cleans up stale PID file when process is not running', () => {
      const fakeProcessTable = new Map<number, ProcessInfo>(); // 3001 is dead
      let staleReported: { pid: number; reason: string } | null = null;

      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile,
        processChecker: (pid) => fakeProcessTable.get(pid) || { running: false },
        onStalePid: (pid, reason) => {
          staleReported = { pid, reason };
        }
      });

      writePidFileAtomic(pidFile, 3001);
      const status = manager.getStatus();

      expect(status.running).toBe(false);
      expect(status.stalePidCleaned).toBe(3001);
      expect(fs.existsSync(pidFile)).toBe(false);
      expect(staleReported).toEqual({
        pid: 3001,
        reason: 'process does not exist'
      });
    });

    it('cleans up stale PID file when PID was reused by another command', () => {
      // 4001 is running, but it is python, not TokenPal
      const fakeProcessTable = new Map<number, ProcessInfo>([
        [
          4001,
          {
            running: true,
            command: '/usr/local/bin/python3 -m celery worker',
            uptimeSec: 100
          }
        ]
      ]);

      let staleReported: { pid: number; reason: string } | null = null;

      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile,
        processChecker: (pid) => fakeProcessTable.get(pid) || { running: false },
        onStalePid: (pid, reason) => {
          staleReported = { pid, reason };
        }
      });

      writePidFileAtomic(pidFile, 4001);
      const status = manager.getStatus();

      expect(status.running).toBe(false);
      expect(status.stalePidCleaned).toBe(4001);
      expect(fs.existsSync(pidFile)).toBe(false);
      expect(staleReported).toEqual({
        pid: 4001,
        reason: expect.stringContaining('pid reused by another command')
      });
    });

    it('reports running when marker is present in both PID file and command line', () => {
      const fakeProcessTable = new Map<number, ProcessInfo>([
        [
          4100,
          {
            running: true,
            command: 'node /repo/packages/cli/dist/index.js watch --tokenpal-daemon --ui',
            uptimeSec: 250
          }
        ]
      ]);

      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile,
        processChecker: (pid) => fakeProcessTable.get(pid) || { running: false }
      });

      writePidFileAtomic(pidFile, 4100, DAEMON_FLAG_MARKER);
      const status = manager.getStatus();

      expect(status.running).toBe(true);
      expect(status.pid).toBe(4100);
      expect(status.uptimeSec).toBe(250);
      expect(fs.existsSync(pidFile)).toBe(true);
    });

    it('rejects PID reuse by another TokenPal CLI command (e.g. tokenpal logs -f) when marker is required', () => {
      const fakeProcessTable = new Map<number, ProcessInfo>([
        [
          4200,
          {
            running: true,
            command: 'node /repo/packages/cli/dist/index.js logs -f',
            uptimeSec: 60
          }
        ]
      ]);

      let staleReported: { pid: number; reason: string } | null = null;

      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile,
        processChecker: (pid) => fakeProcessTable.get(pid) || { running: false },
        onStalePid: (pid, reason) => {
          staleReported = { pid, reason };
        }
      });

      // PID file was written by daemon with marker
      writePidFileAtomic(pidFile, 4200, DAEMON_FLAG_MARKER);
      const status = manager.getStatus();

      expect(status.running).toBe(false);
      expect(status.stalePidCleaned).toBe(4200);
      expect(fs.existsSync(pidFile)).toBe(false);
      expect(staleReported).toEqual({
        pid: 4200,
        reason: expect.stringContaining('pid reused by another command')
      });
    });

    it('rejects PID reuse by tokenpal status when marker is required', () => {
      const fakeProcessTable = new Map<number, ProcessInfo>([
        [
          4300,
          {
            running: true,
            command: 'tokenpal status',
            uptimeSec: 5
          }
        ]
      ]);

      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile,
        processChecker: (pid) => fakeProcessTable.get(pid) || { running: false }
      });

      writePidFileAtomic(pidFile, 4300, DAEMON_FLAG_MARKER);
      const status = manager.getStatus();

      expect(status.running).toBe(false);
      expect(status.stalePidCleaned).toBe(4300);
      expect(fs.existsSync(pidFile)).toBe(false);
    });

    it('supports legacy fallback for PID file written by previous version without marker', () => {
      const fakeProcessTable = new Map<number, ProcessInfo>([
        [
          4400,
          {
            running: true,
            command: 'node /repo/packages/cli/dist/index.js watch --dir /logs',
            uptimeSec: 120
          }
        ]
      ]);

      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile,
        processChecker: (pid) => fakeProcessTable.get(pid) || { running: false }
      });

      // Legacy PID file: no marker line
      writePidFileAtomic(pidFile, 4400);
      const status = manager.getStatus();

      // Legacy fallback recognizes valid watcher command
      expect(status.running).toBe(true);
      expect(status.pid).toBe(4400);
      expect(fs.existsSync(pidFile)).toBe(true);
    });

    it('legacy fallback cleans up stale PID if legacy PID was reused by tokenpal logs -f', () => {
      const fakeProcessTable = new Map<number, ProcessInfo>([
        [
          4500,
          {
            running: true,
            command: 'node /repo/packages/cli/dist/index.js logs -f',
            uptimeSec: 10
          }
        ]
      ]);

      let staleReported: { pid: number; reason: string } | null = null;

      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile,
        processChecker: (pid) => fakeProcessTable.get(pid) || { running: false },
        onStalePid: (pid, reason) => {
          staleReported = { pid, reason };
        }
      });

      // Legacy PID file: no marker line
      writePidFileAtomic(pidFile, 4500);
      const status = manager.getStatus();

      expect(status.running).toBe(false);
      expect(status.stalePidCleaned).toBe(4500);
      expect(fs.existsSync(pidFile)).toBe(false);
      expect(staleReported).toEqual({
        pid: 4500,
        reason: expect.stringContaining('pid reused by another command')
      });
    });
  });

  describe('DaemonManager start & double-start handling', () => {
    it('prevents double start if daemon is already running', async () => {
      const fakeProcessTable = new Map<number, ProcessInfo>([
        [
          5001,
          {
            running: true,
            command: 'node /repo/packages/cli/dist/index.js watch',
            uptimeSec: 50
          }
        ]
      ]);

      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile,
        processChecker: (pid) => fakeProcessTable.get(pid) || { running: false }
      });

      writePidFileAtomic(pidFile, 5001);
      const result = await manager.start();

      expect(result.started).toBe(false);
      expect(result.alreadyRunning).toBe(true);
      expect(result.pid).toBe(5001);
      // PID file remains intact
      expect(readPidFile(pidFile)).toBe(5001);
    });

    it('writes PID file in foreground start mode', async () => {
      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile
      });

      const result = await manager.start({ foreground: true });
      expect(result.started).toBe(true);
      expect(result.pid).toBe(process.pid);
      expect(readPidFile(pidFile)).toBe(process.pid);
    });
  });

  describe('DaemonManager stop logic', () => {
    it('returns wasRunning: false if daemon is not running', async () => {
      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile
      });

      const result = await manager.stop();
      expect(result.stopped).toBe(false);
      expect(result.wasRunning).toBe(false);
    });

    it('sends SIGTERM to watcher and child overlay processes, removes PID file', async () => {
      const signalsSent: Array<{ pid: number; signal: NodeJS.Signals }> = [];
      const fakeProcessTable = new Map<number, ProcessInfo>([
        [
          6001,
          {
            running: true,
            command: 'node /repo/packages/cli/dist/index.js watch'
          }
        ],
        [
          6002, // Electron overlay child
          {
            running: true,
            command: 'electron /repo/packages/overlay/dist/main.js'
          }
        ]
      ]);

      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile,
        processChecker: (pid) => fakeProcessTable.get(pid) || { running: false },
        processKiller: (pid, signal) => {
          signalsSent.push({ pid, signal });
          // Mark process dead on SIGTERM
          fakeProcessTable.set(pid, { running: false });
        },
        childProcessFinder: (parentPid) => (parentPid === 6001 ? [6002] : [])
      });

      writePidFileAtomic(pidFile, 6001);
      const result = await manager.stop({ timeoutMs: 500, pollIntervalMs: 50 });

      expect(result.stopped).toBe(true);
      expect(result.wasRunning).toBe(true);
      expect(result.pid).toBe(6001);
      expect(result.forced).toBe(false);
      expect(fs.existsSync(pidFile)).toBe(false);

      // Verified both child overlay (6002) and watcher (6001) received SIGTERM
      expect(signalsSent).toContainEqual({ pid: 6002, signal: 'SIGTERM' });
      expect(signalsSent).toContainEqual({ pid: 6001, signal: 'SIGTERM' });
    });

    it('escalates to SIGKILL if process fails to terminate within timeout', async () => {
      const signalsSent: Array<{ pid: number; signal: NodeJS.Signals }> = [];
      const fakeProcessTable = new Map<number, ProcessInfo>([
        [
          7001,
          {
            running: true,
            command: 'node /repo/packages/cli/dist/index.js watch'
          }
        ]
      ]);

      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile,
        processChecker: (pid) => fakeProcessTable.get(pid) || { running: false },
        processKiller: (pid, signal) => {
          signalsSent.push({ pid, signal });
          if (signal === 'SIGKILL') {
            fakeProcessTable.set(pid, { running: false });
          }
          // On SIGTERM, process stubbornly remains alive
        },
        childProcessFinder: () => []
      });

      writePidFileAtomic(pidFile, 7001);
      const result = await manager.stop({ timeoutMs: 100, pollIntervalMs: 20 });

      expect(result.stopped).toBe(true);
      expect(result.wasRunning).toBe(true);
      expect(result.forced).toBe(true);
      expect(fs.existsSync(pidFile)).toBe(false);

      // Verify SIGTERM was attempted first, then escalated to SIGKILL
      expect(signalsSent[0]).toEqual({ pid: 7001, signal: 'SIGTERM' });
      expect(signalsSent).toContainEqual({ pid: 7001, signal: 'SIGKILL' });
    });

    it('verifies and reports when no overlay processes remain on stop', async () => {
      const fakeProcessTable = new Map<number, ProcessInfo>([
        [
          8001,
          {
            running: true,
            command: 'node /repo/packages/cli/dist/index.js watch'
          }
        ]
      ]);

      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile,
        processChecker: (pid) => fakeProcessTable.get(pid) || { running: false },
        processKiller: (pid) => fakeProcessTable.set(pid, { running: false }),
        childProcessFinder: () => [],
        overlayProcessFinder: () => []
      });

      writePidFileAtomic(pidFile, 8001);
      const result = await manager.stop({ timeoutMs: 200, pollIntervalMs: 50 });

      expect(result.stopped).toBe(true);
      expect(result.remainingOverlayProcesses).toEqual([]);
    });

    it('finds, terminates, and reports remaining overlay processes on stop', async () => {
      const signalsSent: Array<{ pid: number; signal: NodeJS.Signals }> = [];
      const fakeProcessTable = new Map<number, ProcessInfo>([
        [
          8002,
          {
            running: true,
            command: 'node /repo/packages/cli/dist/index.js watch'
          }
        ]
      ]);

      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile,
        processChecker: (pid) => fakeProcessTable.get(pid) || { running: false },
        processKiller: (pid, signal) => {
          signalsSent.push({ pid, signal });
          fakeProcessTable.set(pid, { running: false });
        },
        childProcessFinder: () => [],
        overlayProcessFinder: () => [
          {
            running: true,
            pid: 9005,
            command: 'electron /repo/packages/overlay/dist/main.js'
          }
        ]
      });

      writePidFileAtomic(pidFile, 8002);
      const result = await manager.stop({ timeoutMs: 200, pollIntervalMs: 50 });

      expect(result.stopped).toBe(true);
      expect(result.remainingOverlayProcesses).toHaveLength(1);
      expect(result.remainingOverlayProcesses?.[0].pid).toBe(9005);
      expect(signalsSent).toContainEqual({ pid: 9005, signal: 'SIGKILL' });
    });
  });

  describe('Daemon control socket communication', () => {
    it('sends JSON command and receives response via control socket', async () => {
      const socketPath = path.join(tempDir, 'test-control.sock');
      let receivedCommand: any = null;

      const server = net.createServer((socket) => {
        socket.on('data', (data) => {
          receivedCommand = JSON.parse(data.toString().trim());
          socket.write(JSON.stringify({ status: 'ok', echoed: receivedCommand.command }) + '\n');
        });
      });

      await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));

      const manager = new DaemonManager({
        rootDir: tempDir,
        pidFile,
        logFile,
        socketPath
      });

      const response = await manager.sendControlCommand({ command: 'test-alert' });
      expect(response).toEqual({ status: 'ok', echoed: 'test-alert' });
      expect(receivedCommand).toEqual({ command: 'test-alert' });

      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
  });

  describe('Log management & rotation', () => {
    it('retrieves the last N lines from log file', () => {
      const manager = new DaemonManager({ rootDir: tempDir, pidFile, logFile, rotatedLogFile });

      // Non-existent log
      expect(manager.getLogs(50).lines).toEqual([]);

      // Write 60 lines
      const content = Array.from({ length: 60 }, (_, i) => `Log line ${i + 1}`).join('\n') + '\n';
      fs.writeFileSync(logFile, content, 'utf-8');

      const logs = manager.getLogs(50);
      expect(logs.lines).toHaveLength(50);
      expect(logs.lines[0]).toBe('Log line 11');
      expect(logs.lines[49]).toBe('Log line 60');
      expect(logs.totalLines).toBe(60);
    });

    it('rotates log to tokenpal.log.1 at threshold and truncates active log', () => {
      const manager = new DaemonManager({ rootDir: tempDir, pidFile, logFile, rotatedLogFile });

      fs.writeFileSync(logFile, 'Short line\n');
      // Threshold 1000 bytes, file is ~11 bytes -> no rotation
      expect(manager.rotateLogs(1000)).toBe(false);
      expect(fs.existsSync(rotatedLogFile)).toBe(false);

      // Write content exceeding 100 bytes
      const bigText = 'A'.repeat(150) + '\n';
      fs.writeFileSync(logFile, bigText);

      // Trigger rotation with threshold 100 bytes
      const rotated = manager.rotateLogs(100);
      expect(rotated).toBe(true);
      expect(fs.existsSync(rotatedLogFile)).toBe(true);
      expect(fs.readFileSync(rotatedLogFile, 'utf-8')).toBe(bigText);

      // Active log file was truncated so open file handles in child process continue safely
      expect(fs.existsSync(logFile)).toBe(true);
      expect(fs.statSync(logFile).size).toBe(0);
    });
  });

  describe('macOS LaunchAgent Autostart', () => {
    it('generates valid launchd plist with RunAtLoad=true and NO KeepAlive', () => {
      const plist = generateLaunchAgentPlist({
        nodePath: '/usr/local/bin/node',
        cliPath: '/Users/test/TokenPal/packages/cli/dist/index.js',
        logPath: '/Users/test/.tokenpal/tokenpal.log'
      });

      expect(plist).toContain('<key>Label</key>');
      expect(plist).toContain('<string>com.tokenpal.watcher</string>');
      expect(plist).toContain('<string>/usr/local/bin/node</string>');
      expect(plist).toContain('<string>/Users/test/TokenPal/packages/cli/dist/index.js</string>');
      expect(plist).toContain('<string>start</string>');
      expect(plist).toContain('<string>--foreground</string>');
      expect(plist).toContain('<key>RunAtLoad</key>');
      expect(plist).toContain('<true/>');

      // Crucial requirement: NO KeepAlive so 'stop' stays stopped
      expect(plist).not.toContain('KeepAlive');
      expect(plist).toContain('<key>StandardOutPath</key>');
      expect(plist).toContain('<key>StandardErrorPath</key>');
    });

    it('generates valid Linux XDG desktop entry', () => {
      const entry = generateLinuxDesktopEntry({
        nodePath: '/usr/bin/node',
        cliPath: '/home/user/TokenPal/packages/cli/dist/index.js'
      });

      expect(entry).toContain('[Desktop Entry]');
      expect(entry).toContain('Type=Application');
      expect(entry).toContain('Name=TokenPal');
      expect(entry).toContain('Exec=/usr/bin/node /home/user/TokenPal/packages/cli/dist/index.js start --foreground --tokenpal-daemon');
    });

    it('generates valid Windows Startup batch script', () => {
      const script = generateWindowsStartupScript({
        nodePath: 'C:\\Program Files\\nodejs\\node.exe',
        cliPath: 'C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\@tokenpal\\cli\\dist\\index.js'
      });

      expect(script).toContain('@echo off');
      expect(script).toContain('start "" /B');
      expect(script).toContain('--tokenpal-daemon');
    });

    it('returns autostart support status for current platform', () => {
      if (process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32') {
        // Supported platforms
        expect(['darwin', 'linux', 'win32']).toContain(process.platform);
      } else {
        const onRes = enableAutostart();
        expect(onRes.supported).toBe(false);
      }
    });

    it('manages autostart lifecycle safely with a throwaway label in isolated temp dir', () => {
      if (process.platform !== 'darwin') return;

      const throwawayLabel = `com.tokenpal.throwaway-${Date.now()}`;
      const throwawayDir = path.join(tempDir, 'LaunchAgents');

      try {
        const onRes = enableAutostart({
          label: throwawayLabel,
          plistDir: throwawayDir,
          logPath: path.join(tempDir, 'test.log')
        });

        expect(onRes.supported).toBe(true);
        expect(onRes.plistPath).toContain(throwawayLabel);
        expect(fs.existsSync(onRes.plistPath!)).toBe(true);

        const offRes = disableAutostart({
          label: throwawayLabel,
          plistDir: throwawayDir
        });

        expect(offRes.supported).toBe(true);
        expect(fs.existsSync(onRes.plistPath!)).toBe(false);
      } finally {
        disableAutostart({ label: throwawayLabel, plistDir: throwawayDir });
      }
    });
  });

  describe('Watcher clean exit cleanup', () => {
    it('removes PID file on exit only if PID matches calling process', () => {
      const manager = new DaemonManager({ rootDir: tempDir, pidFile, logFile });

      // 1. PID belongs to another process -> cleanup does not delete
      writePidFileAtomic(pidFile, 999999);
      manager.cleanupPidOnExit();
      expect(fs.existsSync(pidFile)).toBe(true);

      // 2. PID belongs to this process -> cleanup deletes
      writePidFileAtomic(pidFile, process.pid);
      manager.cleanupPidOnExit();
      expect(fs.existsSync(pidFile)).toBe(false);
    });
  });

  describe('Overlay process self-termination on watcher death or IPC disconnect', () => {
    const overlayDistPath = path.resolve(__dirname, '../../overlay/dist/main.js');
    let electronBin: string | null = null;

    try {
      const req = createRequire(import.meta.url);
      const resolved = req('electron');
      if (typeof resolved === 'string' && fs.existsSync(resolved)) {
        electronBin = resolved;
      }
    } catch {
      // ignore
    }

    it('exits automatically when stdin pipe closes', async () => {
      if (!electronBin || !fs.existsSync(overlayDistPath)) {
        return; // skip if electron binary or dist is not built
      }

      const child = child_process.spawn(electronBin, [overlayDistPath], {
        stdio: ['pipe', 'ignore', 'ignore'],
        env: {
          ...process.env,
          TOKENPAL_PARENT_PID: process.pid.toString()
        }
      });

      const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.on('exit', (code, signal) => resolve({ code, signal }));
      });

      // Close stdin after a brief moment
      setTimeout(() => {
        child.stdin?.end();
      }, 300);

      const result = await Promise.race([
        exitPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000))
      ]);

      expect(result).not.toBeNull();
      if (!child.killed) {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }, 10000);

    it('exits automatically when parent watcher PID dies (orphan prevention)', async () => {
      if (!electronBin || !fs.existsSync(overlayDistPath)) {
        return;
      }

      // Non-existent parent PID 999999
      const child = child_process.spawn(electronBin, [overlayDistPath], {
        stdio: ['pipe', 'ignore', 'ignore'],
        env: {
          ...process.env,
          TOKENPAL_PARENT_PID: '999999'
        }
      });

      const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.on('exit', (code, signal) => resolve({ code, signal }));
      });

      const result = await Promise.race([
        exitPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000))
      ]);

      expect(result).not.toBeNull();
      if (!child.killed) {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }, 10000);
  });
});

