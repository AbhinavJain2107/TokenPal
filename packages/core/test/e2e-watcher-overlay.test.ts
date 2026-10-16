import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { TokenPalDatabase } from '../src/db/database.js';
import { SessionWatcher } from '../src/watcher/watcher.js';
import { RulesEngine } from '../src/rules/engine.js';
import { OverlayLauncher } from '../src/overlay/launcher.js';
import { OverlayAlertPayload } from '../src/overlay/types.js';

describe('End-to-End Watcher to Overlay Integration', () => {
  it('feeds growing synthetic session turns to watcher and delivers red alert to overlay launcher', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenpal-e2e-'));
    const dbPath = path.join(tempDir, 'test.sqlite');
    const sessionDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    const sessionFile = path.join(sessionDir, 'rollout-2026-10-16T12-00-00-01a1e2e.jsonl');

    const db = new TokenPalDatabase(dbPath);
    const engine = new RulesEngine({
      contextGrowthMultiplier: 4.5,
      contextMaxTokens: 120000
    });

    const launcher = new OverlayLauncher();
    const alertSpy = vi.spyOn(launcher, 'showAlert').mockImplementation(() => {});

    const watcher = new SessionWatcher({
      db,
      customDirs: [sessionDir],
      pollIntervalMs: 50
    });

    // Wire up watcher to rules evaluation and launcher (matching CLI watch behavior)
    watcher.on('turn', (payload) => {
      const { session, turn, turnIndex } = payload;
      const turns = db.getTurns(session.id);
      const tools = db.getToolEvents(session.id);
      const evalResult = engine.evaluate(session, turns, tools, true);

      if (evalResult.shouldAlert && evalResult.primaryAlert) {
        const overlayPayload: OverlayAlertPayload = {
          state: evalResult.primaryAlert.severity,
          rule: evalResult.primaryAlert.rule,
          reason: evalResult.primaryAlert.reason,
          advice: evalResult.primaryAlert.advice,
          contextTokens: turn.input_tokens,
          turnCount: turnIndex,
          model: turn.model || session.model
        };
        launcher.showAlert(overlayPayload);
      }
    });

    // Step 1: Session initialization and Turn 1 (baseline ~25k tokens)
    const line0 = JSON.stringify({
      type: 'session_meta',
      payload: {
        session_id: 'e2e-session-123',
        cwd: '/path/to/project',
        cli_version: '0.162.0-alpha.17.2',
        model: 'gpt-6-luna'
      }
    }) + '\n';

    const line1 = JSON.stringify({
      type: 'token_usage_record',
      payload: {
        session_id: 'e2e-session-123',
        turn_token_usage: {
          input_tokens: 25000,
          cached_input_tokens: 5000,
          cache_write_input_tokens: 0,
          output_tokens: 400,
          reasoning_output_tokens: 50,
          total_tokens: 25400
        }
      }
    }) + '\n';

    fs.writeFileSync(sessionFile, line0 + line1);
    await watcher.scanAndProcess();

    // Turn 1 should be green, no alert dispatched to overlay launcher
    expect(alertSpy).not.toHaveBeenCalled();

    // Step 2: Turn 2 (growing to 55k tokens, ~2.2x initial -> warning)
    const line2 = JSON.stringify({
      type: 'token_usage_record',
      payload: {
        session_id: 'e2e-session-123',
        turn_token_usage: {
          input_tokens: 55000,
          cached_input_tokens: 20000,
          cache_write_input_tokens: 0,
          output_tokens: 600,
          reasoning_output_tokens: 100,
          total_tokens: 55600
        }
      }
    }) + '\n';

    fs.appendFileSync(sessionFile, line2);
    await watcher.scanAndProcess();

    // Turn 2 is yellow context_growth warning
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0].state).toBe('yellow');
    expect(alertSpy.mock.calls[0][0].rule).toBe('context_growth');
    expect(alertSpy.mock.calls[0][0].contextTokens).toBe(55000);

    // Step 3: Turn 3 (exploding to 125,000 tokens -> 5.0x initial, crosses 120k threshold -> RED ALERT)
    const line3 = JSON.stringify({
      type: 'token_usage_record',
      payload: {
        session_id: 'e2e-session-123',
        turn_token_usage: {
          input_tokens: 125000,
          cached_input_tokens: 50000,
          cache_write_input_tokens: 0,
          output_tokens: 1200,
          reasoning_output_tokens: 200,
          total_tokens: 126200
        }
      }
    }) + '\n';

    fs.appendFileSync(sessionFile, line3);
    await watcher.scanAndProcess();

    // Turn 3 triggers RED alert reaching the overlay launcher
    expect(alertSpy).toHaveBeenCalledTimes(2);
    const redAlert = alertSpy.mock.calls[1][0];
    expect(redAlert.state).toBe('red');
    expect(redAlert.rule).toBe('context_growth');
    expect(redAlert.contextTokens).toBe(125000);
    expect(redAlert.turnCount).toBe(3);
    expect(redAlert.advice).toContain('Start a new thread with a handoff');

    // Cleanup
    watcher.stop();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
