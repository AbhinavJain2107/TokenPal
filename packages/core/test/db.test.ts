import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TokenPalDatabase } from '../src/db/database.js';
import { Session, Turn } from '../src/types.js';


describe('TokenPalDatabase', () => {
  let db: TokenPalDatabase;

  beforeEach(() => {
    db = new TokenPalDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('initializes schema and creates tables', () => {
    expect(db).toBeDefined();
  });

  it('upserts and retrieves sessions', () => {
    const session: Session = {
      id: 'sess-123',
      agent: 'codex',
      project_path: '/path/to/project',
      started_at: '2026-10-16T10:00:00Z',
      last_event_at: '2026-10-16T10:05:00Z',
      model: 'gpt-6-luna',
      status: 'active'
    };

    db.upsertSession(session);
    const retrieved = db.getSession('sess-123');
    expect(retrieved).toBeDefined();
    expect(retrieved?.agent).toBe('codex');
    expect(retrieved?.model).toBe('gpt-6-luna');
    expect(retrieved?.status).toBe('active');

    // Update session status and last_event_at
    db.upsertSession({
      ...session,
      last_event_at: '2026-10-16T10:10:00Z',
      status: 'completed'
    });

    const updated = db.getSession('sess-123');
    expect(updated?.status).toBe('completed');
    expect(updated?.last_event_at).toBe('2026-10-16T10:10:00Z');
  });

  it('inserts and retrieves turns in chronological order', () => {
    const session: Session = {
      id: 'sess-turns',
      agent: 'codex',
      project_path: null,
      started_at: '2026-10-16T10:00:00Z',
      last_event_at: '2026-10-16T10:00:00Z',
      model: 'gpt-6-luna',
      status: 'active'
    };
    db.upsertSession(session);

    const turn1: Turn = {
      id: 't-1',
      session_id: 'sess-turns',
      ts: '2026-10-16T10:01:00Z',
      input_tokens: 1500,
      output_tokens: 200,
      cached_tokens: 500,
      reasoning_tokens: 50,
      model: 'gpt-6-luna',
      effort: 'medium',
      tool_output_bytes: 120
    };

    const turn2: Turn = {
      id: 't-2',
      session_id: 'sess-turns',
      ts: '2026-10-16T10:02:00Z',
      input_tokens: 3000,
      output_tokens: 250,
      cached_tokens: 1200,
      reasoning_tokens: 60,
      model: 'gpt-6-luna',
      effort: 'medium',
      tool_output_bytes: 340
    };

    db.insertTurn(turn1);
    db.insertTurn(turn2);

    const turns = db.getTurns('sess-turns');
    expect(turns).toHaveLength(2);
    expect(turns[0].id).toBe('t-1');
    expect(turns[1].id).toBe('t-2');
    expect(db.getTurnCount('sess-turns')).toBe(2);
  });

  it('stores and tracks file offsets incrementally', () => {
    db.setFileOffset('/tmp/test.jsonl', 1024, 1690000000, 'sess-1');
    const offset1 = db.getFileOffset('/tmp/test.jsonl');
    expect(offset1?.offset).toBe(1024);
    expect(offset1?.last_session_id).toBe('sess-1');

    db.setFileOffset('/tmp/test.jsonl', 2048, 1690000500);
    const offset2 = db.getFileOffset('/tmp/test.jsonl');
    expect(offset2?.offset).toBe(2048);
    expect(offset2?.last_session_id).toBe('sess-1'); // preserves prior session_id
  });

  it('stores and retrieves settings', () => {
    db.setSetting('threshold.context_growth', '3.0');
    expect(db.getSetting('threshold.context_growth')).toBe('3.0');

    db.setSetting('threshold.context_growth', '4.0');
    expect(db.getSetting('threshold.context_growth')).toBe('4.0');
    expect(db.getSetting('non_existent')).toBeUndefined();
  });

  describe('Alerts DB nullability & migration', () => {
    it('inserts alerts with nullable session_id without auto-creating fake sessions', () => {
      // 1. Meter-level alert with null session_id
      db.insertAlert({
        id: 'alert-meter-1',
        session_id: null,
        ts: '2026-10-18T12:00:00Z',
        rule: 'projected_exhaustion',
        severity: 'yellow',
        shown: 1,
        action_taken: null
      });

      const alerts = db.getAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].id).toBe('alert-meter-1');
      expect(alerts[0].session_id).toBeNull();
      expect(alerts[0].rule).toBe('projected_exhaustion');

      // Crucial: No fake 'meter' session row was created
      expect(db.getSession('meter')).toBeUndefined();
    });

    it('safely migrates existing database with NOT NULL session_id to nullable session_id', () => {
      // Create a temporary database with the legacy schema (NOT NULL session_id and dummy meter session)
      const DatabaseConstructor = (db as any).db.constructor;
      const legacyDb = new DatabaseConstructor(':memory:');
      legacyDb.pragma('foreign_keys = ON');

      legacyDb.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          agent TEXT NOT NULL,
          project_path TEXT,
          started_at TEXT NOT NULL,
          last_event_at TEXT NOT NULL,
          model TEXT,
          status TEXT NOT NULL
        );
        INSERT INTO sessions (id, agent, started_at, last_event_at, status)
        VALUES ('meter', 'meter', '2026-10-18T10:00:00Z', '2026-10-18T10:00:00Z', 'active');
        INSERT INTO sessions (id, agent, started_at, last_event_at, status)
        VALUES ('sess-real', 'codex', '2026-10-18T10:00:00Z', '2026-10-18T10:00:00Z', 'active');

        CREATE TABLE alerts (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          ts TEXT NOT NULL,
          rule TEXT NOT NULL,
          severity TEXT NOT NULL,
          shown INTEGER NOT NULL DEFAULT 0,
          action_taken TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        INSERT INTO alerts VALUES ('a-legacy-1', 'meter', '2026-10-18T10:00:00Z', 'projected_exhaustion', 'yellow', 1, null);
        INSERT INTO alerts VALUES ('a-legacy-2', 'sess-real', '2026-10-18T10:05:00Z', 'single_request_high', 'yellow', 1, null);
      `);

      // Instantiate TokenPalDatabase over the legacy database handle
      const wrappedDb = Object.create(TokenPalDatabase.prototype);
      wrappedDb.db = legacyDb;
      wrappedDb.init();

      // Verify migration converted 'meter' session_id to NULL
      const alerts = wrappedDb.getAlerts();
      expect(alerts).toHaveLength(2);

      const alert1 = alerts.find((a: any) => a.id === 'a-legacy-1');
      expect(alert1?.session_id).toBeNull();

      const alert2 = alerts.find((a: any) => a.id === 'a-legacy-2');
      expect(alert2?.session_id).toBe('sess-real');

      // Verify fake 'meter' session was cleaned up
      expect(wrappedDb.getSession('meter')).toBeUndefined();

      // Verify new alerts with session_id: null can be inserted directly
      wrappedDb.insertAlert({
        id: 'a-new-null',
        session_id: null,
        ts: '2026-10-18T11:00:00Z',
        rule: 'projected_exhaustion',
        severity: 'yellow',
        shown: 1,
        action_taken: null
      });

      const updatedAlerts = wrappedDb.getAlerts();
      expect(updatedAlerts).toHaveLength(3);
      legacyDb.close();
    });

    it('ensures failing DB write does not prevent overlay from being shown', () => {
      // Mock alert emission handler similar to watcher.on('meter', ...) in CLI
      const alert = {
        state: 'yellow' as const,
        rule: 'projected_exhaustion',
        reason: 'Projected quota exhaustion',
        advice: 'Pace remaining tasks'
      };

      let overlayShownWith: any = null;
      const fakeLauncher = {
        showAlert: (payload: any) => {
          overlayShownWith = payload;
        }
      };

      let errorLogged = '';
      const originalConsoleError = console.error;
      console.error = (msg: string) => {
        errorLogged = msg;
      };

      try {
        // Intentionally close db to simulate disk failure / DB error
        db.close();

        // Simulate CLI alert handling block
        try {
          db.insertAlert({
            id: 'failing-alert',
            session_id: null,
            ts: new Date().toISOString(),
            rule: alert.rule,
            severity: alert.state,
            shown: 1,
            action_taken: null
          });
        } catch (err: any) {
          console.error(`[WARN] Failed to record alert to database: ${err?.message || err} [context: rule=${alert.rule}, severity=${alert.state}]`);
        }

        if (fakeLauncher) {
          fakeLauncher.showAlert(alert);
        }
      } finally {
        console.error = originalConsoleError;
      }

      // Assert error was logged with context (no message text/secrets)
      expect(errorLogged).toContain('[WARN] Failed to record alert to database');
      expect(errorLogged).toContain('context: rule=projected_exhaustion, severity=yellow');

      // Assert overlay was still called despite the database failure!
      expect(overlayShownWith).not.toBeNull();
      expect(overlayShownWith.rule).toBe('projected_exhaustion');
    });
  });
});
