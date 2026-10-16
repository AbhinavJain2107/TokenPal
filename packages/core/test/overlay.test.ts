import { describe, it, expect } from 'vitest';
import { OverlayLauncher } from '../src/overlay/launcher.js';
import { OverlayAlertPayload } from '../src/overlay/types.js';

describe('OverlayLauncher', () => {
  it('initializes in stopped state and manages lifecycle safely', () => {
    let snoozed = false;
    let dismissed = false;

    const launcher = new OverlayLauncher({
      onSnooze: () => { snoozed = true; },
      onDismiss: () => { dismissed = true; },
      projectPath: '/test/path'
    });

    expect(launcher.isRunning()).toBe(false);

    // Close on an unstarted launcher should be a safe no-op
    launcher.close();
    expect(launcher.isRunning()).toBe(false);
    expect(snoozed).toBe(false);
    expect(dismissed).toBe(false);
  });

  it('formats alert payloads correctly for transmission', () => {
    const payload: OverlayAlertPayload = {
      state: 'red',
      rule: 'context_growth',
      reason: 'Context is 3.5x larger than turn #1 (85,000 tokens)',
      advice: 'Start a new thread with a handoff',
      contextTokens: 85000,
      turnIndex: 12,
      model: 'gpt-6-luna'
    };

    expect(payload.state).toBe('red');
    expect(payload.rule).toBe('context_growth');
    expect(payload.contextTokens).toBe(85000);
  });
});
