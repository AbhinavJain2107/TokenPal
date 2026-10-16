import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as child_process from 'node:child_process';
import { generateLayerAHandoff, isHandoffGitignored } from '../src/handoff/generator.js';
import { TokenPalDatabase } from '../src/db/database.js';

describe('Handoff Generator (Layer A)', () => {
  let tempRepo: string;

  beforeEach(() => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenpal-handoff-test-'));
    // Setup temporary git repo
    child_process.execSync('git init', { cwd: tempRepo });
    child_process.execSync('git config user.email "test@tokenpal.dev"', { cwd: tempRepo });
    child_process.execSync('git config user.name "TokenPal Test"', { cwd: tempRepo });

    // Initial commit
    fs.writeFileSync(path.join(tempRepo, 'README.md'), '# Initial Repo\n');
    child_process.execSync('git add README.md && git commit -m "init: first commit"', { cwd: tempRepo });

    // Make an unstaged change
    fs.writeFileSync(path.join(tempRepo, 'feature.ts'), 'export const activeFeature = true;\n');
  });

  afterEach(() => {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  });

  it('detects if .handoff is in .gitignore', () => {
    expect(isHandoffGitignored(tempRepo)).toBe(false);

    fs.writeFileSync(path.join(tempRepo, '.gitignore'), 'node_modules/\n.handoff/\n');
    expect(isHandoffGitignored(tempRepo)).toBe(true);
  });

  it('generates a Layer A handoff conforming strictly to PRD template and line budget', async () => {
    const result = await generateLayerAHandoff({
      projectPath: tempRepo,
      firstUserMessage: 'Implement JWT authentication for user accounts',
      latestUserMessage: 'Fix token expiration edge case in tests'
    });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(result.filePath).toBe(path.join(tempRepo, '.handoff', 'latest.md'));

    // Check PRD template sections
    expect(result.markdown).toContain('# Handoff:');
    expect(result.markdown).toContain('Branch / last commit:');
    expect(result.markdown).toContain('Goal: Implement JWT authentication');
    expect(result.markdown).toContain('Done so far: Fix token expiration edge case');
    expect(result.markdown).toContain('Files changed:');
    expect(result.markdown).toContain('Last checks:');
    expect(result.markdown).toContain('Decisions and ruled-out approaches:');
    expect(result.markdown).toContain('Next steps:');

    // PRD FR-11: Handoff must end with verify instruction
    expect(result.markdown.trim().endsWith('Note: verify state with git diff before continuing.')).toBe(true);

    // PRD FR-12: Line count strictly under 60 lines
    expect(result.lineCount).toBeLessThan(60);
    expect(result.lineCount).toBeGreaterThan(5);
  });

  it('integrates session test checks into Last checks section', async () => {
    const db = new TokenPalDatabase(':memory:');
    const sessionId = 'test-session-checks';

    db.upsertSession({
      id: sessionId,
      agent: 'codex',
      project_path: tempRepo,
      started_at: new Date().toISOString(),
      last_event_at: new Date().toISOString(),
      model: 'gpt-6-luna',
      status: 'active'
    });

    db.insertToolEvent({
      id: 'tool-test-1',
      session_id: sessionId,
      ts: new Date().toISOString(),
      name: 'npm test',
      exit_code: 0,
      output_bytes: 450,
      command_hash: null
    });

    const result = await generateLayerAHandoff({
      projectPath: tempRepo,
      session: db.getSession(sessionId),
      db
    });

    expect(result.markdown).toContain('Last checks: npm test: Passed (exit 0)');
    db.close();
  });
});
