import { OverlayAlertPayload } from './types.js';
import { formatLocalTime } from '../meter/meter-reader.js';

export interface DemoStep {
  name: string;
  description: string;
  payload: OverlayAlertPayload;
  openCustomize?: boolean;
}

/**
 * Returns the 5 demonstration states cycling through all guardian conditions
 * and all 5 skin animations (idle, walk, sleep, alert, happy).
 *
 * Preserves the exact 5 canonical meter states for tests and legacy callers.
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
      description: 'DEMO: Healthy quota (18% used) with [Idle] animation',
      payload: {
        state: 'green',
        reason: 'DEMO: Quota is healthy (18% used) · Mascot in [IDLE] state',
        advice: 'Pace is sustainable for normal development. Click mascot to inspect.',
        contextTokens: 14250,
        turnIndex: 6,
        model: 'gpt-5-sol',
        animationOverride: 'idle',
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
      description: 'DEMO ALERT: Projected quota exhaustion with [Alert] animation and auto-opened panel',
      payload: {
        state: 'yellow',
        rule: 'projected_exhaustion',
        reason: 'DEMO ALERT: Projected quota exhaustion in ~18h · Mascot in [ALERT] state',
        advice: 'Pace remaining tasks or conclude long threads. Note: meter reflects usage across all active sessions.',
        contextTokens: 48900,
        turnIndex: 19,
        model: 'gpt-5-sol',
        animationOverride: 'alert',
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
      description: 'DEMO ALERT: Single high request (+4%) with [Alert / Walk] animation',
      payload: {
        state: 'yellow',
        rule: 'single_request_high',
        reason: 'DEMO ALERT: Single request measured about +4% meter change · Mascot in [ALERT] state',
        advice: 'Break large prompts into smaller tasks. Note: the meter is shared across all sessions.',
        contextTokens: 112000,
        turnIndex: 24,
        model: 'gpt-5-sol',
        animationOverride: 'alert',
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
      description: 'DEMO: Astra model badge notice with [Happy] animation and speech bubble',
      payload: {
        state: 'green',
        rule: 'astra_active',
        notice: 'Astra model badge active',
        reason: 'DEMO NOTICE: Switched to Astra · Mascot in [HAPPY] animation',
        advice: 'Be mindful of larger allowance burn rate on Astra model.',
        contextTokens: 62400,
        turnIndex: 28,
        model: 'gpt-6-astra-preview',
        animationOverride: 'happy',
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
      description: 'DEMO: Stale meter warning with [Sleep] animation (no popup)',
      payload: {
        state: 'yellow',
        rule: 'stale_reading',
        reason: 'DEMO STALE: Meter reading is older than 30 minutes · Mascot in [SLEEP] animation',
        advice: 'Run an agent turn or check network connectivity to refresh meter.',
        contextTokens: 62400,
        turnIndex: 28,
        model: 'gpt-6-astra-preview',
        animationOverride: 'sleep',
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

/**
 * Returns complete sequence showcasing all 6 animations (idle, walk, speech notice/happy,
 * curious look-up, alert with badge and auto-open, sleep with no popup) for `tokenpal demo`.
 */
export function getAllDemoStates(): DemoStep[] {
  const base = getDemoStates();
  const now = Date.now();
  const resetEpoch = Math.floor(now / 1000) + (4 * 86400 + 8 * 3600);
  const resetLocal = formatLocalTime(resetEpoch);
  const nowLocal = formatLocalTime(now);

  const roamingStep: DemoStep = {
    name: 'roaming',
    description: 'DEMO: Walking across desktop edge · Mascot in [WALK] state',
    payload: {
      state: 'green',
      reason: 'DEMO: Roaming gently along desktop edge · Mascot in [WALK] state',
      advice: 'Roaming can be toggled in Customize.',
      animationOverride: 'walk',
      meter: {
        usedPercent: 20,
        percentBar: '[██░░░░░░░░░░] 20%',
        timeToResetFormatted: '5d 11h',
        resetsAtLocal: resetLocal,
        asOfLocal: nowLocal,
        isStale: false,
        planType: 'prolite'
      }
    }
  };

  const curiousStep: DemoStep = {
    name: 'expensive_request',
    description: 'DEMO: Noticeable request (+3.2%) · Mascot in [CURIOUS / LOOK-UP] state',
    payload: {
      state: 'green',
      reason: 'DEMO: New request cost +3.2% · Mascot looks up curiously',
      advice: 'Mascot reacts to significant requests without opening alert panel.',
      contextTokens: 62400,
      turnIndex: 16,
      model: 'gpt-5-sol',
      animationOverride: 'curious',
      meter: {
        usedPercent: 31,
        percentBar: '[████░░░░░░░░] 31%',
        timeToResetFormatted: '5d 6h',
        resetsAtLocal: resetLocal,
        asOfLocal: nowLocal,
        isStale: false,
        planType: 'prolite',
        requestCostDisplay: '+3.2% (2 calls, 31,400 tokens)'
      }
    }
  };

  // Order: Healthy(idle) -> Roaming(walk) -> Notice(happy + speech) -> Curious(look-up) -> Alerts -> Sleep
  return [
    base[0], // healthy (idle)
    roamingStep, // walk
    base[3], // astra_badge / notice (happy)
    curiousStep, // curious
    base[1], // projected_exhaustion (alert)
    base[2], // single_request_high (alert)
    base[4]  // stale_reading (sleep)
  ];
}
