export type Severity = 'green' | 'yellow' | 'red';

export interface RuleSignal {
  rule: string;
  severity: Severity;
  score: number; // 0 to 100
  triggered: boolean;
  reason: string;
  advice: string;
}

export interface RuleThresholds {
  // Context Growth
  contextGrowthMultiplier: number; // default: 3.0 (3x first turn)
  contextMaxTokens: number; // default: 100000

  // Turn Count
  turnCountWarning: number; // default: 30
  turnCountMax: number; // default: 40

  // Expensive Models
  expensiveModels: string[]; // default: ['gpt-6-astra', 'o1-pro', 'claude-3-5-opus']

  // High Effort on Simple Task
  highEffortMaxTokens: number; // default: 10000 (tokens considered simple prompt)

  // Retry Loop
  retryLoopThreshold: number; // default: 3 consecutive failures

  // Large Tool Output
  toolOutputMaxBytes: number; // default: 50000 (50 KB)

  // Exploration Crawl
  explorationToolThreshold: number; // default: 8 tool calls in 3 turns

  // Low Cache Hit Ratio
  cacheRatioMinPercent: number; // default: 20%
  cacheRatioMinTurn: number; // default: 5 turns

  // Daily Burn Rate
  dailyBudgetTokens: number; // default: 500000
}

export interface RuleEvaluationResult {
  sessionId: string;
  turnIndex: number;
  state: Severity;
  signals: RuleSignal[];
  primaryAlert: RuleSignal | null;
  isBreakpoint: boolean;
  cooldownActive: boolean;
  shouldAlert: boolean;
}
