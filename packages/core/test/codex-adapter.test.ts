import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { CodexAdapter } from '../src/adapters/codex.js';

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter();
  const fixturePath = path.resolve(__dirname, 'fixtures', 'codex-sample.jsonl');

  it('recognizes rollout session file names', () => {
    expect(adapter.canHandle('/path/to/rollout-2026-10-16.jsonl')).toBe(true);
    expect(adapter.canHandle('/path/to/other.txt')).toBe(false);
  });

  it('parses redacted fixture successfully', async () => {
    expect(fs.existsSync(fixturePath)).toBe(true);
    const result = await adapter.parseIncremental(fixturePath, 0);

    expect(result.error).toBeUndefined();
    expect(result.session).toBeDefined();
    expect(result.turns.length).toBeGreaterThan(0);

    // Verify token values from fixture
    for (const turn of result.turns) {
      expect(typeof turn.input_tokens).toBe('number');
      expect(typeof turn.output_tokens).toBe('number');
      expect(typeof turn.cached_tokens).toBe('number');
      expect(typeof turn.reasoning_tokens).toBe('number');
      expect(turn.cached_tokens).toBeLessThanOrEqual(turn.input_tokens);
      expect(turn.reasoning_tokens).toBeLessThanOrEqual(turn.output_tokens);
    }

    expect(result.newOffset).toBe(fs.statSync(fixturePath).size);
    expect(result.userMessagesCount).toBe(4);
    expect(result.modelCallsCount).toBe(5);
    expect(result.compactionsCount).toBe(0);
  });

  it('handles partial lines safely without corruption', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenpal-test-partial-'));
    const tempFile = path.join(tempDir, 'rollout-temp.jsonl');

    const line1 = JSON.stringify({ type: 'session_meta', payload: { session_id: 'sess-p', cwd: '/test' } }) + '\n';
    const line2 = JSON.stringify({
      type: 'token_usage_record',
      payload: {
        session_id: 'sess-p',
        turn_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 2 }
      }
    }) + '\n';

    // Write line 1 and half of line 2
    const partialLine2 = line2.slice(0, 30);
    fs.writeFileSync(tempFile, line1 + partialLine2);

    // First parse: should parse line1 only and set offset at end of line1
    const res1 = await adapter.parseIncremental(tempFile, 0);
    expect(res1.error).toBeUndefined();
    expect(res1.newOffset).toBe(Buffer.byteLength(line1, 'utf-8'));
    expect(res1.turns).toHaveLength(0); // line2 wasn't complete yet

    // Complete line 2
    fs.appendFileSync(tempFile, line2.slice(30));

    // Second parse from newOffset
    const res2 = await adapter.parseIncremental(tempFile, res1.newOffset);
    expect(res2.error).toBeUndefined();
    expect(res2.turns).toHaveLength(1);
    expect(res2.turns[0].input_tokens).toBe(100);
    expect(res2.newOffset).toBe(Buffer.byteLength(line1 + line2, 'utf-8'));

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('fails safe with "unsupported version" on corrupted/non-JSON data', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenpal-test-corrupt-'));
    const tempFile = path.join(tempDir, 'rollout-corrupted.jsonl');

    fs.writeFileSync(tempFile, 'NOT_JSON_LINE_1\nNOT_JSON_LINE_2\n');
    const result = await adapter.parseIncremental(tempFile, 0);

    expect(result.error).toBe('unsupported version');
    expect(result.turns).toHaveLength(0);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
