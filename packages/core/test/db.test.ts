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
});
