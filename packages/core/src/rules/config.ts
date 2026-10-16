import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RuleThresholds } from './types.js';

export const DEFAULT_THRESHOLDS: RuleThresholds = {
  contextGrowthMultiplier: 3.0,
  contextMaxTokens: 100000,
  turnCountWarning: 30,
  turnCountMax: 40,
  expensiveModels: ['gpt-6-astra', 'o1-pro', 'claude-3-5-opus', 'gpt-5-pro'],
  highEffortMaxTokens: 10000,
  retryLoopThreshold: 3,
  toolOutputMaxBytes: 50000,
  explorationToolThreshold: 8,
  cacheRatioMinPercent: 20,
  cacheRatioMinTurn: 5,
  dailyBudgetTokens: 500000
};

export function loadRuleThresholds(customConfigPath?: string): RuleThresholds {
  const configPath = customConfigPath || path.join(os.homedir(), '.tokenpal', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (data && typeof data === 'object') {
        return {
          ...DEFAULT_THRESHOLDS,
          ...(data.thresholds || {})
        };
      }
    } catch {
      // Fallback to defaults on parse error
    }
  }
  return { ...DEFAULT_THRESHOLDS };
}
