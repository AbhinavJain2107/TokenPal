import { Turn, ToolEvent, Session } from '../types.js';
import { RuleSignal, RuleThresholds, RuleEvaluationResult, Severity } from './types.js';
import { DEFAULT_THRESHOLDS } from './config.js';

export class RulesEngine {
  private thresholds: RuleThresholds;
  private sessionCooldowns = new Map<string, { lastAlertTokens: number; lastAlertTurn: number; snoozedUntil?: number }>();

  constructor(thresholds: Partial<RuleThresholds> = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  public setThresholds(thresholds: Partial<RuleThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  public snooze(sessionId: string, durationMinutes = 30): void {
    const until = Date.now() + durationMinutes * 60 * 1000;
    const existing = this.sessionCooldowns.get(sessionId) || { lastAlertTokens: 0, lastAlertTurn: 0 };
    this.sessionCooldowns.set(sessionId, { ...existing, snoozedUntil: until });
  }

  public evaluate(
    session: Session,
    turns: Turn[],
    toolEvents: ToolEvent[] = [],
    isBreakpoint = true
  ): RuleEvaluationResult {
    const signals: RuleSignal[] = [];
    const turnCount = turns.length;
    const currentTurn = turns[turns.length - 1];

    if (!currentTurn) {
      return {
        sessionId: session.id,
        turnIndex: 0,
        state: 'green',
        signals: [],
        primaryAlert: null,
        isBreakpoint,
        cooldownActive: false,
        shouldAlert: false
      };
    }

    const firstTurn = turns[0];
    const initialInput = firstTurn?.input_tokens || currentTurn.input_tokens || 1;
    const currentInput = currentTurn.input_tokens;

    // 1. Context Growth Signal
    const growthRatio = currentInput / initialInput;
    if (currentInput >= this.thresholds.contextMaxTokens || growthRatio >= this.thresholds.contextGrowthMultiplier) {
      signals.push({
        rule: 'context_growth',
        severity: 'red',
        score: Math.min(100, Math.round(growthRatio * 30)),
        triggered: true,
        reason: `Context is ${growthRatio.toFixed(1)}x larger than turn #1 (${currentInput.toLocaleString()} tokens)`,
        advice: 'Start a new thread with a handoff'
      });
    } else if (growthRatio >= 2.0 || currentInput >= this.thresholds.contextMaxTokens * 0.7) {
      signals.push({
        rule: 'context_growth',
        severity: 'yellow',
        score: Math.min(80, Math.round(growthRatio * 25)),
        triggered: true,
        reason: `Context has reached ${currentInput.toLocaleString()} tokens (${growthRatio.toFixed(1)}x initial)`,
        advice: 'Consider concluding current task soon'
      });
    }

    // 2. Turn Count Signal
    if (turnCount >= this.thresholds.turnCountMax) {
      signals.push({
        rule: 'turn_count',
        severity: 'red',
        score: Math.min(100, 70 + (turnCount - this.thresholds.turnCountMax) * 2),
        triggered: true,
        reason: `Session has reached ${turnCount} turns (max recommended: ${this.thresholds.turnCountMax})`,
        advice: 'Start fresh or compact'
      });
    } else if (turnCount >= this.thresholds.turnCountWarning) {
      signals.push({
        rule: 'turn_count',
        severity: 'yellow',
        score: 50 + (turnCount - this.thresholds.turnCountWarning) * 2,
        triggered: true,
        reason: `Session has reached ${turnCount} turns (approaching limit)`,
        advice: 'Plan to finish or summarize this thread'
      });
    }

    // 3. Expensive Model Signal
    const currentModel = currentTurn.model || session.model;
    if (currentModel && this.thresholds.expensiveModels.some(m => currentModel.toLowerCase().includes(m.toLowerCase()))) {
      signals.push({
        rule: 'expensive_model',
        severity: 'yellow',
        score: 65,
        triggered: true,
        reason: `Active model is costly tier (${currentModel})`,
        advice: 'Confirm the task needs it'
      });
    }

    // 4. High Effort on Simple Task
    if (currentTurn.effort === 'high' && currentInput <= this.thresholds.highEffortMaxTokens) {
      signals.push({
        rule: 'high_effort',
        severity: 'yellow',
        score: 55,
        triggered: true,
        reason: `High reasoning effort on small context (${currentInput.toLocaleString()} tokens)`,
        advice: 'Try medium effort'
      });
    }

    // 5. Retry Loop Signal (consecutive tool failures)
    if (toolEvents.length >= this.thresholds.retryLoopThreshold) {
      const recentTools = toolEvents.slice(-this.thresholds.retryLoopThreshold);
      const allFailed = recentTools.every(t => typeof t.exit_code === 'number' && t.exit_code !== 0);
      if (allFailed) {
        signals.push({
          rule: 'retry_loop',
          severity: 'red',
          score: 85,
          triggered: true,
          reason: `Tool commands failed ${this.thresholds.retryLoopThreshold} times consecutively`,
          advice: 'Stop and diagnose the root cause yourself'
        });
      }
    }

    // 6. Large Tool Output
    if (currentTurn.tool_output_bytes >= this.thresholds.toolOutputMaxBytes) {
      const kb = Math.round(currentTurn.tool_output_bytes / 1024);
      signals.push({
        rule: 'large_tool_output',
        severity: 'yellow',
        score: 60,
        triggered: true,
        reason: `Tool output size is large (${kb} KB)`,
        advice: 'Trim output next time'
      });
    }

    // 7. Exploration Crawl
    const recentTurnsCount = Math.min(3, turns.length);
    const recentTurns = turns.slice(-recentTurnsCount);
    const recentToolCount = toolEvents.filter(te => {
      if (recentTurns.length === 0) return false;
      return te.ts >= recentTurns[0].ts;
    }).length;

    if (recentToolCount >= this.thresholds.explorationToolThreshold) {
      signals.push({
        rule: 'exploration_crawl',
        severity: 'yellow',
        score: 55,
        triggered: true,
        reason: `${recentToolCount} tool operations in last ${recentTurnsCount} turns`,
        advice: 'Narrow scope or split by folder'
      });
    }

    // 8. Low Cache Hit Ratio
    if (turnCount >= this.thresholds.cacheRatioMinTurn && currentTurn.input_tokens > 0) {
      const cacheRatio = (currentTurn.cached_tokens / currentTurn.input_tokens) * 100;
      if (cacheRatio < this.thresholds.cacheRatioMinPercent) {
        signals.push({
          rule: 'low_cache_ratio',
          severity: 'yellow',
          score: 50,
          triggered: true,
          reason: `Prompt cache hit ratio dropped to ${cacheRatio.toFixed(1)}%`,
          advice: 'Avoid editing earlier context mid-thread'
        });
      }
    }

    // 9. Burn Rate
    const totalSessionTokens = turns.reduce((acc, t) => acc + t.input_tokens + t.output_tokens, 0);
    if (totalSessionTokens >= this.thresholds.dailyBudgetTokens) {
      signals.push({
        rule: 'burn_rate',
        severity: 'red',
        score: 90,
        triggered: true,
        reason: `Session tokens (${totalSessionTokens.toLocaleString()}) exceeded daily pace (${this.thresholds.dailyBudgetTokens.toLocaleString()})`,
        advice: 'Slow down or plan credits'
      });
    }

    // Determine overall state
    let state: Severity = 'green';
    if (signals.some(s => s.severity === 'red')) {
      state = 'red';
    } else if (signals.some(s => s.severity === 'yellow')) {
      state = 'yellow';
    }

    // Primary alert (highest severity and score)
    const sortedSignals = [...signals].sort((a, b) => {
      const sevWeight = { red: 3, yellow: 2, green: 1 };
      if (sevWeight[b.severity] !== sevWeight[a.severity]) {
        return sevWeight[b.severity] - sevWeight[a.severity];
      }
      return b.score - a.score;
    });

    const primaryAlert = sortedSignals.length > 0 ? sortedSignals[0] : null;

    // Check Cooldown / Snooze
    let cooldownActive = false;
    const cooldown = this.sessionCooldowns.get(session.id);
    const now = Date.now();

    if (cooldown) {
      // Check snooze
      if (cooldown.snoozedUntil && now < cooldown.snoozedUntil) {
        cooldownActive = true;
      } else {
        // Material worsening check: context grew by 20% or 5+ turns since last alert
        const tokenGrowthSinceAlert = currentInput - cooldown.lastAlertTokens;
        const tokenGrowthPct = cooldown.lastAlertTokens > 0 ? (tokenGrowthSinceAlert / cooldown.lastAlertTokens) : 1;
        const turnsSinceAlert = turnCount - cooldown.lastAlertTurn;

        if (tokenGrowthPct < 0.20 && turnsSinceAlert < 5) {
          cooldownActive = true;
        }
      }
    }

    // Breakpoint rule: only escalate to RED when agent is at a breakpoint (FR-7)
    let shouldAlert = false;
    if (state === 'red') {
      shouldAlert = isBreakpoint && !cooldownActive;
    } else if (state === 'yellow') {
      shouldAlert = !cooldownActive;
    }

    if (shouldAlert && primaryAlert) {
      this.sessionCooldowns.set(session.id, {
        lastAlertTokens: currentInput,
        lastAlertTurn: turnCount
      });
    }

    return {
      sessionId: session.id,
      turnIndex: turnCount,
      state,
      signals,
      primaryAlert,
      isBreakpoint,
      cooldownActive,
      shouldAlert
    };
  }
}
