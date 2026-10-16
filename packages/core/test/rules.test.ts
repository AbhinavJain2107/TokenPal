import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { RulesEngine } from '../src/rules/engine.js';
import { Session, Turn, ToolEvent } from '../src/types.js';
import { replaySessionFile } from '../src/replay/replay.js';
import { CodexAdapter } from '../src/adapters/codex.js';

describe('RulesEngine - PRD 6.2 Signals', () => {
  const dummySession: Session = {
    id: 'test-session',
    agent: 'codex',
    project_path: '/my/project',
    started_at: '2026-10-16T10:00:00Z',
    last_event_at: '2026-10-16T10:05:00Z',
    model: 'gpt-6-luna',
    status: 'active'
  };

  const createTurn = (idx: number, inputTokens: number, overrides: Partial<Turn> = {}): Turn => ({
    id: `turn-${idx}`,
    session_id: 'test-session',
    ts: new Date(Date.now() + idx * 60000).toISOString(),
    input_tokens: inputTokens,
    output_tokens: 200,
    cached_tokens: Math.floor(inputTokens * 0.5),
    reasoning_tokens: 30,
    model: 'gpt-6-luna',
    effort: 'medium',
    tool_output_bytes: 500,
    ...overrides
  });

  it('Rule 1: Context Growth triggers red alert when context is >= 4.5x first turn', () => {
    const engine = new RulesEngine();
    const turns = [
      createTurn(1, 10000),
      createTurn(2, 20000),
      createTurn(3, 46000) // 4.6x growth >= 4.5
    ];

    const result = engine.evaluate(dummySession, turns, []);
    expect(result.state).toBe('red');
    const signal = result.signals.find(s => s.rule === 'context_growth');
    expect(signal).toBeDefined();
    expect(signal?.severity).toBe('red');
    expect(signal?.advice).toContain('Start a new thread with a handoff');
  });

  it('Rule 2: Turn Count triggers alert when exceeding threshold', () => {
    const engine = new RulesEngine({ turnCountMax: 40 });
    const turns: Turn[] = [];
    for (let i = 1; i <= 41; i++) {
      turns.push(createTurn(i, 5000));
    }

    const result = engine.evaluate(dummySession, turns, []);
    expect(result.state).toBe('red');
    const signal = result.signals.find(s => s.rule === 'turn_count');
    expect(signal).toBeDefined();
    expect(signal?.severity).toBe('red');
    expect(signal?.advice).toContain('Start fresh or compact');
  });

  it('Rule 3: Expensive Model triggers warning on top tier models', () => {
    const engine = new RulesEngine({ expensiveModels: ['gpt-6-astra'] });
    const turns = [
      createTurn(1, 5000, { model: 'gpt-6-astra' })
    ];

    const result = engine.evaluate({ ...dummySession, model: 'gpt-6-astra' }, turns, []);
    expect(result.state).toBe('yellow');
    const signal = result.signals.find(s => s.rule === 'expensive_model');
    expect(signal).toBeDefined();
    expect(signal?.reason).toContain('Active model is costly tier');
  });

  it('Rule 4: High Effort on Simple Task triggers warning', () => {
    const engine = new RulesEngine({ highEffortMaxTokens: 10000 });
    const turns = [
      createTurn(1, 3000, { effort: 'high' })
    ];

    const result = engine.evaluate(dummySession, turns, []);
    const signal = result.signals.find(s => s.rule === 'high_effort');
    expect(signal).toBeDefined();
    expect(signal?.severity).toBe('yellow');
    expect(signal?.advice).toBe('Try medium effort');
  });

  it('Rule 5: Retry Loop triggers red alert on consecutive tool failures', () => {
    const engine = new RulesEngine({ retryLoopThreshold: 3 });
    const turns = [createTurn(1, 5000)];
    const tools: ToolEvent[] = [
      { id: '1', session_id: 'test-session', ts: '2026-10-16T10:01:00Z', name: 'exec', exit_code: 1, output_bytes: 100, command_hash: null },
      { id: '2', session_id: 'test-session', ts: '2026-10-16T10:02:00Z', name: 'exec', exit_code: 127, output_bytes: 100, command_hash: null },
      { id: '3', session_id: 'test-session', ts: '2026-10-16T10:03:00Z', name: 'exec', exit_code: 1, output_bytes: 100, command_hash: null }
    ];

    const result = engine.evaluate(dummySession, turns, tools);
    expect(result.state).toBe('red');
    const signal = result.signals.find(s => s.rule === 'retry_loop');
    expect(signal).toBeDefined();
    expect(signal?.advice).toContain('Stop and diagnose the root cause yourself');
  });

  it('Rule 6: Large Tool Output triggers warning when exceeding limit', () => {
    const engine = new RulesEngine({ toolOutputMaxBytes: 50000 });
    const turns = [
      createTurn(1, 5000, { tool_output_bytes: 75000 })
    ];

    const result = engine.evaluate(dummySession, turns, []);
    const signal = result.signals.find(s => s.rule === 'large_tool_output');
    expect(signal).toBeDefined();
    expect(signal?.severity).toBe('yellow');
    expect(signal?.advice).toContain('Trim output next time');
  });

  it('Rule 7: Exploration Crawl triggers warning on high tool density', () => {
    const engine = new RulesEngine({ explorationToolThreshold: 8 });
    const turns = [
      createTurn(1, 5000),
      createTurn(2, 6000),
      createTurn(3, 7000)
    ];
    const tools: ToolEvent[] = [];
    for (let i = 0; i < 9; i++) {
      tools.push({
        id: `tool-${i}`,
        session_id: 'test-session',
        ts: turns[1].ts,
        name: 'read_file',
        exit_code: 0,
        output_bytes: 200,
        command_hash: null
      });
    }

    const result = engine.evaluate(dummySession, turns, tools);
    const signal = result.signals.find(s => s.rule === 'exploration_crawl');
    expect(signal).toBeDefined();
    expect(signal?.severity).toBe('yellow');
    expect(signal?.advice).toContain('Narrow scope or split by folder');
  });

  it('Rule 8: Low Cache Hit Ratio triggers warning on long threads with poor caching', () => {
    const engine = new RulesEngine({ cacheRatioMinTurn: 5, cacheRatioMinPercent: 20 });
    const turns: Turn[] = [];
    for (let i = 1; i <= 6; i++) {
      turns.push(createTurn(i, 20000, { cached_tokens: 500 })); // 2.5% cache ratio
    }

    const result = engine.evaluate(dummySession, turns, []);
    const signal = result.signals.find(s => s.rule === 'low_cache_ratio');
    expect(signal).toBeDefined();
    expect(signal?.severity).toBe('yellow');
    expect(signal?.advice).toContain('Avoid editing earlier context mid-thread');
  });

  it('Rule 9: Burn Rate triggers alert when session exceeds budget', () => {
    const engine = new RulesEngine({ dailyBudgetTokens: 100000 });
    const turns = [
      createTurn(1, 60000, { output_tokens: 10000 }),
      createTurn(2, 50000, { output_tokens: 5000 }) // Total: 125,000 tokens
    ];

    const result = engine.evaluate(dummySession, turns, []);
    expect(result.state).toBe('red');
    const signal = result.signals.find(s => s.rule === 'burn_rate');
    expect(signal).toBeDefined();
    expect(signal?.advice).toContain('Slow down or plan credits');
  });

  it('Breakpoint and Cooldown logic suppresses duplicate alerts until worsening', () => {
    const engine = new RulesEngine();
    const turns = [
      createTurn(1, 10000),
      createTurn(2, 46000) // 4.6x growth -> should alert
    ];

    const firstEval = engine.evaluate(dummySession, turns, [], true);
    expect(firstEval.shouldAlert).toBe(true);

    // Turn 3: slight growth (47000), cooldown should suppress alert
    const turnsWithSlightGrowth = [
      ...turns,
      createTurn(3, 47000)
    ];
    const secondEval = engine.evaluate(dummySession, turnsWithSlightGrowth, [], true);
    expect(secondEval.cooldownActive).toBe(true);
    expect(secondEval.shouldAlert).toBe(false);

    // Turn 4: material worsening (>20% growth: 58000 tokens) -> should alert again
    const turnsWithMaterialGrowth = [
      ...turnsWithSlightGrowth,
      createTurn(4, 58000)
    ];
    const thirdEval = engine.evaluate(dummySession, turnsWithMaterialGrowth, [], true);
    expect(thirdEval.cooldownActive).toBe(false);
    expect(thirdEval.shouldAlert).toBe(true);
  });

  it('Tuned thresholds on codex-sample fixture fire RED at Turn #4 (106k tokens), keeping Turn #3 (74k) as YELLOW', async () => {
    const fixturePath = path.resolve(__dirname, 'fixtures', 'codex-sample.jsonl');
    const res = await replaySessionFile(fixturePath, [new CodexAdapter()]);

    expect(res.error).toBeUndefined();
    expect(res.turns).toHaveLength(5);

    // Turn 2: 46,999 tokens -> YELLOW warning (2.06x initial)
    expect(res.turns[1].turnIndex).toBe(2);
    expect(res.turns[1].inputTokens).toBe(46999);
    expect(res.turns[1].state).toBe('yellow');

    // Turn 3: 74,208 tokens -> stays YELLOW (3.26x initial, < 4.5x and < 120k)
    expect(res.turns[2].turnIndex).toBe(3);
    expect(res.turns[2].inputTokens).toBe(74208);
    expect(res.turns[2].state).toBe('yellow');

    // Turn 4: 106,204 tokens -> triggers RED alert (4.67x initial >= 4.5x, in 100k-150k target range)
    expect(res.turns[3].turnIndex).toBe(4);
    expect(res.turns[3].inputTokens).toBe(106204);
    expect(res.turns[3].state).toBe('red');
    expect(res.turns[3].alert?.rule).toBe('context_growth');
    expect(res.turns[3].alert?.severity).toBe('red');

    // Turn 5: 32,535 tokens (reset/compacted) -> green
    expect(res.turns[4].turnIndex).toBe(5);
    expect(res.turns[4].state).toBe('green');
  });
});
