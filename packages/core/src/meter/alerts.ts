import { MeterStatus, UserRequestCost } from '../types.js';
import { OverlayAlertPayload } from '../overlay/types.js';

export interface MeterAlertOptions {
  cooldownMs?: number; // default: 3600_000 (1 hour)
  singleRequestThresholdPercent?: number; // default: 3.0
}

export class MeterAlertManager {
  private cooldownMs: number;
  private singleRequestThresholdPercent: number;
  private lastAlertTimeByType = new Map<string, number>();

  constructor(options: MeterAlertOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? 3600 * 1000; // 1 hour
    this.singleRequestThresholdPercent = options.singleRequestThresholdPercent ?? 3.0;
  }

  public checkProjectedExhaustion(status: MeterStatus, nowMs: number = Date.now()): OverlayAlertPayload | null {
    if (status.projectedExhaustionHours === undefined || !status.projectedExhaustionText) {
      return null;
    }

    // Check if projected exhaustion is before reset
    const currentEpochSec = Math.floor(nowMs / 1000);
    const exhaustionEpochSec = currentEpochSec + Math.round(status.projectedExhaustionHours * 3600);
    if (exhaustionEpochSec >= status.resetsAt) {
      return null;
    }

    const lastAlert = this.lastAlertTimeByType.get('projected_exhaustion') || 0;
    if (nowMs - lastAlert < this.cooldownMs) {
      return null;
    }

    this.lastAlertTimeByType.set('projected_exhaustion', nowMs);

    const hoursRounded = Math.round(status.projectedExhaustionHours);
    const timeDisplay = hoursRounded >= 48 ? `${Math.round(hoursRounded / 24)}d` : `${hoursRounded}h`;

    return {
      state: 'yellow',
      rule: 'projected_exhaustion',
      reason: `Projected quota exhaustion in ~${timeDisplay} (before next reset in ${status.timeToResetFormatted}; note: meter covers all concurrent sessions)`,
      advice: 'Pace remaining tasks or conclude long threads. Note: meter reflects usage across all active sessions.',
      meter: {
        usedPercent: status.usedPercent,
        timeToResetFormatted: status.timeToResetFormatted,
        planType: status.planType,
        percentBar: status.percentBar,
        earlyResetsCount: status.earlyResetsCount,
        earlyResetsNote: status.earlyResetsNote,
        projectedExhaustionText: status.projectedExhaustionText,
        modelBadgeText: status.modelBadgeText
      }
    };
  }

  public checkRequestCost(cost: UserRequestCost, status?: MeterStatus | null, nowMs: number = Date.now()): OverlayAlertPayload | null {
    if (cost.spannedReset || cost.deltaPercent < this.singleRequestThresholdPercent) {
      return null;
    }

    const lastAlert = this.lastAlertTimeByType.get('single_request_high') || 0;
    if (nowMs - lastAlert < this.cooldownMs) {
      return null;
    }

    this.lastAlertTimeByType.set('single_request_high', nowMs);

    return {
      state: 'yellow',
      rule: 'single_request_high',
      reason: `Single request measured about +${Math.round(cost.deltaPercent)}% meter change (note: meter covers all sessions; jump may not come from this request alone)`,
      advice: 'Break large prompts into smaller tasks. Note: the meter is shared across all sessions.',
      meter: status ? {
        usedPercent: status.usedPercent,
        timeToResetFormatted: status.timeToResetFormatted,
        planType: status.planType,
        percentBar: status.percentBar,
        earlyResetsCount: status.earlyResetsCount,
        earlyResetsNote: status.earlyResetsNote,
        projectedExhaustionText: status.projectedExhaustionText,
        modelBadgeText: status.modelBadgeText,
        requestCostDisplay: cost.costDisplay
      } : {
        usedPercent: cost.endUsedPercent,
        timeToResetFormatted: '',
        planType: '',
        requestCostDisplay: cost.costDisplay
      }
    };
  }

  public resetCooldowns(): void {
    this.lastAlertTimeByType.clear();
  }
}
