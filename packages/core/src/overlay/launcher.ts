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

  constructor(options: OverlayLauncherOptions = {}) {
    this.options = options;
  }

  public isRunning(): boolean {
    return this.child !== null && !this.child.killed;
  }

  public showAlert(payload: OverlayAlertPayload): void {
    if (!this.isRunning()) {
      this.spawnOverlay(payload);
    } else if (this.child?.stdin) {
      const msg = JSON.stringify({ type: 'SHOW_ALERT', payload }) + '\n';
      this.child.stdin.write(msg);
    }
  }

  public close(): void {
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
      this.child = child_process.spawn(spawnCmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TOKENPAL_PARENT_PID: process.pid.toString(),
          TOKENPAL_OVERLAY_INITIAL: initialPayload ? JSON.stringify(initialPayload) : ''
        }
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
      });
    } catch {
      this.child = null;
    }
  }
}
