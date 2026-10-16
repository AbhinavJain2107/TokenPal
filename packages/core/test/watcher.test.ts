import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { TokenPalDatabase } from '../src/db/database.js';
import { SessionWatcher } from '../src/watcher/watcher.js';

describe('SessionWatcher', () => {
  let db: TokenPalDatabase;
  let tempDir: string;

  beforeEach(() => {
    db = new TokenPalDatabase(':memory:');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenpal-watcher-test-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('watches session file and emits turn event on new data', async () => {
    const sessionFile = path.join(tempDir, 'rollout-test.jsonl');
    const watcher = new SessionWatcher({
      db,
      customDirs: [tempDir],
      pollIntervalMs: 100
    });

    const emittedTurns: any[] = [];
    watcher.on('turn', (payload) => {
      emittedTurns.push(payload);
    });

    // Write initial session meta
    const line1 = JSON.stringify({
      type: 'session_meta',
      timestamp: '2026-10-16T12:00:00Z',
      payload: { session_id: 'test-sess-w', cwd: '/workspace' }
    }) + '\n';
    fs.writeFileSync(sessionFile, line1);

    await watcher.scanAndProcess();
    expect(emittedTurns).toHaveLength(0);

    // Append turn 1
    const line2 = JSON.stringify({
      type: 'token_usage_record',
      timestamp: '2026-10-16T12:01:00Z',
      payload: {
        session_id: 'test-sess-w',
        turn_token_usage: {
          input_tokens: 5000,
          cached_input_tokens: 2000,
          output_tokens: 300,
          reasoning_output_tokens: 50
        }
      }
    }) + '\n';
    fs.appendFileSync(sessionFile, line2);

    await watcher.scanAndProcess();

    expect(emittedTurns).toHaveLength(1);
    expect(emittedTurns[0].turn.input_tokens).toBe(5000);
    expect(emittedTurns[0].turnIndex).toBe(1);

    // Verify stored in DB
    const dbTurns = db.getTurns('test-sess-w');
    expect(dbTurns).toHaveLength(1);
    expect(dbTurns[0].input_tokens).toBe(5000);

    // Verify offset is recorded
    const offset = db.getFileOffset(sessionFile);
    expect(offset?.offset).toBe(Buffer.byteLength(line1 + line2, 'utf-8'));

    // Append turn 2
    const line3 = JSON.stringify({
      type: 'token_usage_record',
      timestamp: '2026-10-16T12:02:00Z',
      payload: {
        session_id: 'test-sess-w',
        turn_token_usage: {
          input_tokens: 12000,
          cached_input_tokens: 4500,
          output_tokens: 450,
          reasoning_output_tokens: 60
        }
      }
    }) + '\n';
    fs.appendFileSync(sessionFile, line3);

    await watcher.scanAndProcess();

    expect(emittedTurns).toHaveLength(2);
    expect(emittedTurns[1].turn.input_tokens).toBe(12000);
    expect(emittedTurns[1].turnIndex).toBe(2);
    expect(db.getTurns('test-sess-w')).toHaveLength(2);
  });
});
