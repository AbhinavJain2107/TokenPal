import DatabaseConstructor, { Database as BetterSQLiteDatabase } from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';
import { Session, Turn, ToolEvent, Alert, Handoff, FileOffset, MeterSnapshot, QuotaReset } from '../types.js';


export class TokenPalDatabase {
  private db: BetterSQLiteDatabase;

  constructor(dbPath: string = ':memory:') {
    this.db = new DatabaseConstructor(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
  }

  private init(): void {
    this.db.exec(SCHEMA_SQL);
  }

  public close(): void {
    this.db.close();
  }

  public upsertSession(session: Session): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, agent, project_path, started_at, last_event_at, model, status)
      VALUES (@id, @agent, @project_path, @started_at, @last_event_at, @model, @status)
      ON CONFLICT(id) DO UPDATE SET
        project_path = COALESCE(@project_path, sessions.project_path),
        last_event_at = @last_event_at,
        model = COALESCE(@model, sessions.model),
        status = @status
    `);
    stmt.run(session);
  }

  public getSession(id: string): Session | undefined {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    return stmt.get(id) as Session | undefined;
  }

  public getRecentSessions(limit = 20): Session[] {
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY last_event_at DESC LIMIT ?');
    return stmt.all(limit) as Session[];
  }

  public insertTurn(turn: Turn): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO turns (
        id, session_id, ts, input_tokens, output_tokens, cached_tokens, reasoning_tokens, model, effort, tool_output_bytes
      ) VALUES (
        @id, @session_id, @ts, @input_tokens, @output_tokens, @cached_tokens, @reasoning_tokens, @model, @effort, @tool_output_bytes
      )
    `);
    stmt.run(turn);
  }

  public getTurns(sessionId: string): Turn[] {
    const stmt = this.db.prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY ts ASC');
    return stmt.all(sessionId) as Turn[];
  }

  public getTurnCount(sessionId: string): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM turns WHERE session_id = ?');
    const result = stmt.get(sessionId) as { count: number };
    return result ? result.count : 0;
  }

  public insertToolEvent(event: ToolEvent): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tool_events (
        id, session_id, ts, name, exit_code, output_bytes, command_hash
      ) VALUES (
        @id, @session_id, @ts, @name, @exit_code, @output_bytes, @command_hash
      )
    `);
    stmt.run(event);
  }

  public getToolEvents(sessionId: string): ToolEvent[] {
    const stmt = this.db.prepare('SELECT * FROM tool_events WHERE session_id = ? ORDER BY ts ASC');
    return stmt.all(sessionId) as ToolEvent[];
  }

  public insertAlert(alert: Alert): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO alerts (id, session_id, ts, rule, severity, shown, action_taken)
      VALUES (@id, @session_id, @ts, @rule, @severity, @shown, @action_taken)
    `);
    stmt.run(alert);
  }

  public getAlerts(sessionId: string): Alert[] {
    const stmt = this.db.prepare('SELECT * FROM alerts WHERE session_id = ? ORDER BY ts ASC');
    return stmt.all(sessionId) as Alert[];
  }

  public insertHandoff(handoff: Handoff): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO handoffs (id, session_id, ts, path)
      VALUES (@id, @session_id, @ts, @path)
    `);
    stmt.run(handoff);
  }

  public getFileOffset(filePath: string): FileOffset | undefined {
    const stmt = this.db.prepare('SELECT * FROM file_offsets WHERE file_path = ?');
    return stmt.get(filePath) as FileOffset | undefined;
  }

  public setFileOffset(filePath: string, offset: number, lastMtime: number, lastSessionId: string | null = null): void {
    const stmt = this.db.prepare(`
      INSERT INTO file_offsets (file_path, offset, last_mtime, last_session_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        offset = excluded.offset,
        last_mtime = excluded.last_mtime,
        last_session_id = COALESCE(excluded.last_session_id, file_offsets.last_session_id)
    `);
    stmt.run(filePath, offset, lastMtime, lastSessionId);
  }

  public getSetting(key: string): string | undefined {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const result = stmt.get(key) as { value: string } | undefined;
    return result?.value;
  }

  public setSetting(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    stmt.run(key, value);
  }

  public insertMeterSnapshot(snapshot: MeterSnapshot): void {
    const stmt = this.db.prepare(`
      INSERT INTO meter_snapshots (session_id, ts, used_percent, window_minutes, resets_at, plan_type)
      VALUES (@session_id, @ts, @used_percent, @window_minutes, @resets_at, @plan_type)
    `);
    stmt.run({
      session_id: snapshot.session_id || null,
      ts: snapshot.ts,
      used_percent: snapshot.used_percent,
      window_minutes: snapshot.window_minutes,
      resets_at: snapshot.resets_at,
      plan_type: snapshot.plan_type || null
    });
  }

  public getLatestMeterSnapshot(): MeterSnapshot | undefined {
    const stmt = this.db.prepare('SELECT * FROM meter_snapshots ORDER BY ts DESC LIMIT 1');
    return stmt.get() as MeterSnapshot | undefined;
  }

  public getRecentMeterSnapshots(sinceTs: string): MeterSnapshot[] {
    const stmt = this.db.prepare('SELECT * FROM meter_snapshots WHERE ts >= ? ORDER BY ts ASC');
    return stmt.all(sinceTs) as MeterSnapshot[];
  }

  public insertQuotaReset(reset: QuotaReset): void {
    const stmt = this.db.prepare(`
      INSERT INTO quota_resets (ts, prev_used_percent, prev_resets_at, new_resets_at, is_early)
      VALUES (@ts, @prev_used_percent, @prev_resets_at, @new_resets_at, @is_early)
    `);
    stmt.run({
      ts: reset.ts,
      prev_used_percent: reset.prev_used_percent ?? null,
      prev_resets_at: reset.prev_resets_at ?? null,
      new_resets_at: reset.new_resets_at,
      is_early: reset.is_early ? 1 : 0
    });
  }

  public getRecentQuotaResets(limitOrSince?: number | string): QuotaReset[] {
    if (typeof limitOrSince === 'string') {
      const stmt = this.db.prepare('SELECT * FROM quota_resets WHERE ts >= ? ORDER BY ts DESC');
      return stmt.all(limitOrSince) as QuotaReset[];
    }
    const limit = typeof limitOrSince === 'number' ? limitOrSince : 10;
    const stmt = this.db.prepare('SELECT * FROM quota_resets ORDER BY ts DESC LIMIT ?');
    return stmt.all(limit) as QuotaReset[];
  }

  public getEarlyResetCount(sinceTs: string): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM quota_resets WHERE is_early = 1 AND ts >= ?');
    const result = stmt.get(sinceTs) as { count: number };
    return result ? result.count : 0;
  }
}

