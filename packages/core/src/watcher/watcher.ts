import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { AgentAdapter } from '../adapters/interface.js';
import { CodexAdapter } from '../adapters/codex.js';
import { TokenPalDatabase } from '../db/database.js';
import { TurnEventPayload, Session } from '../types.js';

export interface WatcherOptions {
  db: TokenPalDatabase;
  adapters?: AgentAdapter[];
  customDirs?: string[];
  pollIntervalMs?: number;
}

export class SessionWatcher extends EventEmitter {
  private db: TokenPalDatabase;
  private adapters: AgentAdapter[];
  private customDirs: string[];
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private pollIntervalMs: number;

  constructor(options: WatcherOptions) {
    super();
    this.db = options.db;
    this.adapters = options.adapters || [new CodexAdapter()];
    this.customDirs = options.customDirs || [];
    this.pollIntervalMs = options.pollIntervalMs || 1000;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Initial scan and tail
    await this.scanAndProcess();

    // Periodic check for new or updated files
    this.timer = setInterval(async () => {
      try {
        await this.scanAndProcess();
      } catch (err) {
        this.emit('error', err);
      }
    }, this.pollIntervalMs);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getWatchDirs(): string[] {
    if (this.customDirs.length > 0) {
      return [...this.customDirs];
    }
    const dirs: string[] = [];
    for (const adapter of this.adapters) {
      for (const d of adapter.getDefaultWatchDirs()) {
        if (!dirs.includes(d)) dirs.push(d);
      }
    }
    return dirs;
  }


  public async scanAndProcess(): Promise<void> {
    const dirs = this.getWatchDirs();
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = this.findSessionFiles(dir);
      for (const file of files) {
        await this.processFile(file);
      }
    }
  }

  private findSessionFiles(baseDir: string): string[] {
    const results: string[] = [];
    const walk = (d: string, depth = 0) => {
      if (depth > 6) return; // safety depth
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          walk(full, depth + 1);
        } else if (e.isFile()) {
          for (const adapter of this.adapters) {
            if (adapter.canHandle(full)) {
              results.push(full);
              break;
            }
          }
        }
      }
    };
    walk(baseDir);
    return results;
  }

  public async processFile(filePath: string): Promise<void> {
    let adapter: AgentAdapter | undefined;
    for (const a of this.adapters) {
      if (a.canHandle(filePath)) {
        adapter = a;
        break;
      }
    }
    if (!adapter) return;

    let stats: fs.Stats;
    try {
      stats = fs.statSync(filePath);
    } catch {
      return;
    }

    const currentMtime = Math.floor(stats.mtimeMs);
    const existingOffsetRecord = this.db.getFileOffset(filePath);
    let startOffset = existingOffsetRecord ? existingOffsetRecord.offset : 0;

    // Handle file rotation or truncation: if file is smaller than offset, reset offset
    if (stats.size < startOffset) {
      startOffset = 0;
    }

    // If nothing changed since last parse, skip
    if (existingOffsetRecord && stats.size === startOffset && currentMtime <= existingOffsetRecord.last_mtime) {
      return;
    }

    const parseResult = await adapter.parseIncremental(filePath, startOffset);

    if (parseResult.error) {
      this.emit('unsupported', { filePath, error: parseResult.error });
      return;
    }

    let session: Session | undefined;
    if (parseResult.session && parseResult.session.id) {
      const existingSession = this.db.getSession(parseResult.session.id);
      session = {
        id: parseResult.session.id,
        agent: parseResult.session.agent || adapter.id,
        project_path: parseResult.session.project_path || existingSession?.project_path || null,
        started_at: parseResult.session.started_at || existingSession?.started_at || new Date().toISOString(),
        last_event_at: parseResult.session.last_event_at || new Date().toISOString(),
        model: parseResult.session.model || existingSession?.model || null,
        status: (parseResult.session.status as any) || existingSession?.status || 'active'
      };
      this.db.upsertSession(session);
    }

    // Process tool events
    for (const tool of parseResult.toolEvents) {
      this.db.insertToolEvent(tool);
    }

    // Process turns
    const currentTurnCount = session ? this.db.getTurnCount(session.id) : 0;
    let turnIndex = currentTurnCount;

    for (const turn of parseResult.turns) {
      turnIndex++;
      this.db.insertTurn(turn);
      if (session) {
        const payload: TurnEventPayload = {
          session,
          turn,
          turnIndex,
          isNewTurn: true
        };
        this.emit('turn', payload);
      }
    }

    // Save offset
    this.db.setFileOffset(filePath, parseResult.newOffset, currentMtime, session?.id || null);
  }
}
