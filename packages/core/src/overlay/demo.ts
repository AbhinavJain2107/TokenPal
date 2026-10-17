import { OverlayAlertPayload } from './types.js';
import { formatLocalTime } from '../meter/meter-reader.js';

export interface DemoStep {
  name: string;
  description: string;
  payload: OverlayAlertPayload;
}

/**
 * Returns the 5 demonstration states cycling through all guardian conditions:
 * 1. Healthy (green, no alerts, sustainable pace)
 * 2. Projected Exhaustion (yellow, projection warns exhaustion before reset)
 * 3. Single High Request (yellow, single turn jumped by +4%)
 * 4. Astra Badge (active Astra model with 2 to 3x multiplier badge)
 * 5. Stale Reading (yellow, reading older than 30m or reset passed)
 *
 * Uses fake data exclusively with zero file reads.
 */
export function getDemoStates(): DemoStep[] {
  const now = Date.now();
  const resetEpoch = Math.floor(now / 1000) + (4 * 86400 + 8 * 3600); // 4d 8h in future
  const resetLocal = formatLocalTime(resetEpoch);
  const nowLocal = formatLocalTime(now);
  const staleLocal = formatLocalTime(now - 45 * 60 * 1000); // 45m ago

  return [
    {
      name: 'healthy',
      description: 'Healthy quota (18% used, calm breathing, no alerts)',
      payload: {
        state: 'green',
        reason: 'Quota is healthy · No alerts',
        advice: 'Pace is sustainable for normal development.',
        contextTokens: 14250,
        turnIndex: 6,
        model: 'gpt-5-sol',
        meter: {
          usedPercent: 18,
          percentBar: '[██░░░░░░░░░░] 18%',
          timeToResetFormatted: '5d 12h',
          resetsAtLocal: resetLocal,
          asOfLocal: nowLocal,
          isStale: false,
          planType: 'prolite',
          earlyResetsCount: 0
        }
      }
    },
    {
      name: 'projected_exhaustion',
      description: 'Projected exhaustion warning (quota will run out before next reset)',
      payload: {
        state: 'yellow',
        rule: 'projected_exhaustion',
        reason: 'Projected quota exhaustion in ~18h (before next reset in 4d 8h; note: meter covers all concurrent sessions)',
        advice: 'Pace remaining tasks or conclude long threads. Note: meter reflects usage across all active sessions.',
        contextTokens: 48900,
        turnIndex: 19,
        model: 'gpt-5-sol',
        meter: {
          usedPercent: 72,
          percentBar: '[█████████░░░] 72%',
          timeToResetFormatted: '4d 8h',
          resetsAtLocal: resetLocal,
          asOfLocal: nowLocal,
          isStale: false,
          planType: 'prolite',
          projectedExhaustionText: 'At current rate (+4.2%/hr), quota will run out in ~18h',
          earlyResetsCount: 0
        }
      }
    },
    {
      name: 'single_request_high',
      description: 'Single high request warning (turn jumped meter by +4%)',
      payload: {
        state: 'yellow',
        rule: 'single_request_high',
        reason: 'Single request measured about +4% meter change (note: meter covers all sessions; jump may not come from this request alone)',
        advice: 'Break large prompts into smaller tasks. Note: the meter is shared across all sessions.',
        contextTokens: 112000,
        turnIndex: 24,
        model: 'gpt-5-sol',
        meter: {
          usedPercent: 76,
          percentBar: '[█████████░░░] 76%',
          timeToResetFormatted: '4d 7h',
          resetsAtLocal: resetLocal,
          asOfLocal: nowLocal,
          isStale: false,
          planType: 'prolite',
          requestCostDisplay: '+4% (3 calls, 42,500 tokens)'
        }
      }
    },
    {
      name: 'astra_badge',
      description: 'Astra model badge notice (roughly 2 to 3x multiplier)',
      payload: {
        state: 'green',
        rule: 'astra_active',
        reason: 'Active model: Astra (uses roughly 2 to 3x Sol\'s allowance)',
        advice: 'Be mindful of larger allowance burn rate on Astra.',
        contextTokens: 62400,
        turnIndex: 28,
        model: 'gpt-6-astra-preview',
        meter: {
          usedPercent: 78,
          percentBar: '[█████████░░░] 78%',
          timeToResetFormatted: '4d 6h',
          resetsAtLocal: resetLocal,
          asOfLocal: nowLocal,
          isStale: false,
          planType: 'prolite',
          modelBadgeText: "Astra uses roughly 2 to 3x Sol's allowance (estimate)"
        }
      }
    },
    {
      name: 'stale_reading',
      description: 'Stale meter warning (last reading older than 30m)',
      payload: {
        state: 'yellow',
        rule: 'stale_reading',
        reason: 'Meter reading is stale (last updated 45m ago; >30m threshold)',
        advice: 'Run an agent turn or check network connectivity to refresh meter.',
        contextTokens: 62400,
        turnIndex: 28,
        model: 'gpt-6-astra-preview',
        meter: {
          usedPercent: 78,
          percentBar: '[█████████░░░] 78%',
          timeToResetFormatted: '4d 5h',
          resetsAtLocal: resetLocal,
          asOfLocal: staleLocal,
          isStale: true,
          staleReason: 'Meter reading is older than 30 minutes (45m ago)',
          planType: 'prolite'
        }
      }
    }
  ];
}
