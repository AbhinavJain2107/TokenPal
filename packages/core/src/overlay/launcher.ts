import * as child_process from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { OverlayAlertPayload } from './types.js';
import { generateLayerAHandoff } from '../handoff/generator.js';

export interface OverlayLauncherOptions {
  onSnooze?: (minutes: number) => void;
  onDismiss?: () => void;
  projectPath?: string;
}

export class OverlayLauncher {
  private child: child_process.ChildProcess | null = null;
  private options: OverlayLauncherOptions;

  private restartAttempts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private resetBackoffTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private latestPayload: OverlayAlertPayload | null = null;

  constructor(options: OverlayLauncherOptions = {}) {
    this.options = options;
  }

  public isRunning(): boolean {
    return this.child !== null && !this.child.killed;
  }

  /**
   * Starts the overlay at startup and ensures it remains running persistently.
   */
  public start(initialPayload?: OverlayAlertPayload): void {
    this.isShuttingDown = false;
    if (initialPayload) {
      this.latestPayload = initialPayload;
    }
    if (!this.isRunning()) {
      this.spawnOverlay(this.latestPayload || initialPayload);
    }
  }

  public showAlert(payload: OverlayAlertPayload): void {
    this.latestPayload = payload;
    if (!this.isRunning()) {
      this.spawnOverlay(payload);
    } else if (this.child?.stdin && this.child.stdin.writable) {
      try {
        const msg = JSON.stringify({ type: 'SHOW_ALERT', payload }) + '\n';
        this.child.stdin.write(msg, () => {});
      } catch {
        // ignore write error
      }
    }
  }

  public updateMeter(payload: OverlayAlertPayload): void {
    this.latestPayload = payload;
    if (!this.isRunning()) {
      this.spawnOverlay(payload);
    } else if (this.child?.stdin && this.child.stdin.writable) {
      try {
        const msg = JSON.stringify({ type: 'METER_UPDATE', payload }) + '\n';
        this.child.stdin.write(msg, () => {});
      } catch {
        // ignore write error
      }
    }
  }

  public close(): void {
    this.isShuttingDown = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.resetBackoffTimer) {
      clearTimeout(this.resetBackoffTimer);
      this.resetBackoffTimer = null;
    }
    if (this.child && !this.child.killed) {
      try {
        if (this.child.stdin) {
          this.child.stdin.write(JSON.stringify({ type: 'QUIT' }) + '\n');
        }
        this.child.kill('SIGTERM');
      } catch {
        // ignore
      }
      this.child = null;
    }
  }

  private findOverlayEntry(): string | null {
    // Check local dist or package dist
    const currentDir = typeof __dirname !== 'undefined'
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));

    const possiblePaths = [
      path.resolve(currentDir, '../../../overlay/dist/main.js'),
      path.resolve(currentDir, '../../overlay/dist/main.js'),
      path.resolve(process.cwd(), 'packages/overlay/dist/main.js')
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p;
    }

    try {
      const req = createRequire(import.meta.url);
      const overlayPkg = req.resolve('tokenpal-overlay/package.json');
      const overlayMain = path.resolve(path.dirname(overlayPkg), 'dist/main.js');
      if (fs.existsSync(overlayMain)) return overlayMain;
    } catch {
      // ignore
    }

    return null;
  }

  private findElectronPath(entryPath: string): string {
    if (process.env.ELECTRON_PATH && fs.existsSync(process.env.ELECTRON_PATH)) {
      return process.env.ELECTRON_PATH;
    }
    try {
      const req = createRequire(entryPath);
      const resolved = req('electron');
      if (typeof resolved === 'string' && fs.existsSync(resolved)) {
        return resolved;
      }
    } catch {
      // ignore
    }
    return 'electron';
  }

  private spawnOverlay(initialPayload?: OverlayAlertPayload): void {
    const entryPath = this.findOverlayEntry();
    if (!entryPath) return;

    const electronBin = this.findElectronPath(entryPath);
    const isDirectBin = fs.existsSync(electronBin);
    const spawnCmd = isDirectBin ? electronBin : 'npx';
    const spawnArgs = isDirectBin ? [entryPath] : ['--yes', 'electron', entryPath];

    try {
      const childEnv = { ...process.env };
      delete childEnv.ELECTRON_RUN_AS_NODE;

      this.child = child_process.spawn(spawnCmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...childEnv,
          TOKENPAL_PARENT_PID: process.pid.toString(),
          TOKENPAL_OVERLAY_INITIAL: initialPayload ? JSON.stringify(initialPayload) : ''
        }
      });

      this.child.on('error', () => {
        this.child = null;
      });

      this.child.stdin?.on('error', () => {
        // Prevent unhandled EPIPE if overlay closes
      });

      this.child.stdout?.setEncoding('utf-8');
      this.child.stdout?.on('data', async (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line.trim());
            if (msg.action === 'copy-handoff') {
              await generateLayerAHandoff({ projectPath: this.options.projectPath });
            } else if (msg.action === 'snooze') {
              this.options.onSnooze?.(msg.payload || 30);
            } else if (msg.action === 'dismiss') {
              this.options.onDismiss?.();
            }
          } catch {
            // ignore malformed stdout
          }
        }
      });

      this.child.on('exit', () => {
        this.child = null;
        if (!this.isShuttingDown) {
          const delayMs = Math.min(30000, 1000 * Math.pow(2, this.restartAttempts));
          this.restartAttempts++;
          this.restartTimer = setTimeout(() => {
            if (!this.isShuttingDown && !this.isRunning()) {
              this.spawnOverlay(this.latestPayload || undefined);
            }
          }, delayMs);
        }
      });

      // Reset backoff counter after 15 seconds of healthy execution
      if (this.resetBackoffTimer) clearTimeout(this.resetBackoffTimer);
      this.resetBackoffTimer = setTimeout(() => {
        if (this.isRunning()) {
          this.restartAttempts = 0;
        }
      }, 15000);
    } catch {
      this.child = null;
    }
  }
}
