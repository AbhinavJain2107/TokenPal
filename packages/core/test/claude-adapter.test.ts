import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { ClaudeAdapter } from '../src/adapters/claude.js';

describe('ClaudeAdapter', () => {
  const adapter = new ClaudeAdapter();
  const fixturePath = path.resolve(__dirname, 'fixtures', 'claude-sample.jsonl');

  it('recognizes Claude project session file paths and UUID naming', () => {
    expect(adapter.canHandle('/Users/user/.claude/projects/-project-slug/26d0bef8-3cd3-474d-9011-d099134468f2.jsonl')).toBe(true);
    expect(adapter.canHandle('C:\\Users\\user\\.claude\\projects\\proj\\26d0bef8-3cd3-474d-9011-d099134468f2.jsonl')).toBe(true);
    expect(adapter.canHandle('/path/to/claude-session.jsonl')).toBe(true);
    expect(adapter.canHandle('/path/to/26d0bef8-3cd3-474d-9011-d099134468f2.jsonl')).toBe(true);
    // Non-matching files
    expect(adapter.canHandle('/Users/user/.claude/history.jsonl')).toBe(false);
    expect(adapter.canHandle('/Users/user/.claude/settings.json')).toBe(false);
    expect(adapter.canHandle('/path/to/random.txt')).toBe(false);
  });

  it('discovers watch directories if they exist', () => {
    const dirs = adapter.getDefaultWatchDirs();
    expect(Array.isArray(dirs)).toBe(true);
  });

  it('parses redacted fixture successfully with correct token and tool tracking', async () => {
    expect(fs.existsSync(fixturePath)).toBe(true);
    const result = await adapter.parseIncremental(fixturePath, 0);

    expect(result.error).toBeUndefined();
    expect(result.session).toBeDefined();
    expect(result.session?.id).toBe('26d0bef8-3cd3-474d-9011-d099134468f2');
    expect(result.session?.agent).toBe('claude');
    expect(result.session?.model).toBe('claude-3-5-sonnet-20241022');
    expect(result.session?.project_path).toBe('/workspace/test-project');

    // 2 assistant turns
    expect(result.turns).toHaveLength(2);

    const turn1 = result.turns[0];
    expect(turn1.id).toBe('turn-assistant-1');
    expect(turn1.input_tokens).toBe(1250);
    expect(turn1.output_tokens).toBe(85);
    expect(turn1.cached_tokens).toBe(1000); // 750 read + 250 creation
    expect(turn1.model).toBe('claude-3-5-sonnet-20241022');

    const turn2 = result.turns[1];
    expect(turn2.id).toBe('turn-assistant-2');
    expect(turn2.input_tokens).toBe(1380);
    expect(turn2.output_tokens).toBe(120);
    expect(turn2.cached_tokens).toBe(1000);
    // Tool output bytes accumulated from tool_result in turn 1
    expect(turn2.tool_output_bytes).toBeGreaterThan(0);

    // 1 tool result event captured
    expect(result.toolEvents).toHaveLength(1);
    expect(result.toolEvents[0].name).toBe('Bash');
    expect(result.toolEvents[0].exit_code).toBe(0);
    expect(result.toolEvents[0].output_bytes).toBeGreaterThan(0);

    // Lifecycle events
    expect(result.taskEvents?.some((e) => e.type === 'task_started')).toBe(true);
    expect(result.taskEvents?.some((e) => e.type === 'task_complete')).toBe(true);

    expect(result.userMessagesCount).toBe(2);
    expect(result.modelCallsCount).toBe(2);
    expect(result.newOffset).toBe(fs.statSync(fixturePath).size);
  });

  it('handles partial lines safely without corruption', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenpal-claude-test-partial-'));
    const tempFile = path.join(tempDir, 'claude-temp.jsonl');

    const line1 = JSON.stringify({ type: 'user', sessionId: 'sess-c', cwd: '/test-proj', timestamp: '2026-10-29T07:53:26.000Z' }) + '\n';
    const line2 = JSON.stringify({
      type: 'assistant',
      sessionId: 'sess-c',
      message: {
        model: 'claude-3-5-sonnet-20241022',
        usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 200 }
      }
    }) + '\n';

    // Write line 1 and partial line 2
    const partialLine2 = line2.slice(0, 25);
    fs.writeFileSync(tempFile, line1 + partialLine2);

    const res1 = await adapter.parseIncremental(tempFile, 0);
    expect(res1.error).toBeUndefined();
    expect(res1.newOffset).toBe(Buffer.byteLength(line1, 'utf-8'));
    expect(res1.turns).toHaveLength(0);

    // Complete line 2
    fs.appendFileSync(tempFile, line2.slice(25));

    const res2 = await adapter.parseIncremental(tempFile, res1.newOffset);
    expect(res2.error).toBeUndefined();
    expect(res2.turns).toHaveLength(1);
    expect(res2.turns[0].input_tokens).toBe(500);
    expect(res2.turns[0].cached_tokens).toBe(200);
    expect(res2.newOffset).toBe(Buffer.byteLength(line1 + line2, 'utf-8'));

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('fails safe with "unsupported version" on corrupted/non-JSON data', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenpal-claude-test-corrupt-'));
    const tempFile = path.join(tempDir, 'claude-corrupted.jsonl');

    fs.writeFileSync(tempFile, 'INVALID_DATA_LINE_1\nINVALID_DATA_LINE_2\n');
    const result = await adapter.parseIncremental(tempFile, 0);

    expect(result.error).toBe('unsupported version');
    expect(result.turns).toHaveLength(0);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('is strictly read-only and never modifies source files', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenpal-claude-readonly-'));
    const tempFile = path.join(tempDir, 'claude-readonly.jsonl');
    const initialContent = fs.readFileSync(fixturePath, 'utf-8');
    fs.writeFileSync(tempFile, initialContent, 'utf-8');

    const mtimeBefore = fs.statSync(tempFile).mtimeMs;
    await adapter.parseIncremental(tempFile, 0);
    const mtimeAfter = fs.statSync(tempFile).mtimeMs;
    const contentAfter = fs.readFileSync(tempFile, 'utf-8');

    expect(contentAfter).toBe(initialContent);
    expect(mtimeAfter).toBe(mtimeBefore);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
