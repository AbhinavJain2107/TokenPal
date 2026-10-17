import { TokenPalDatabase } from '../db/database.js';
import { MeterReading, QuotaReset, MeterStatus } from '../types.js';
import { calculateProjection } from './projection.js';
import { MeterReaderOptions } from './types.js';

export function formatPercentBar(percent: number, width = 12): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${Math.round(clamped)}%`;
}

export function formatRemainingTime(resetsAtEpochSec: number, currentEpochSec: number = Math.floor(Date.now() / 1000)): string {
  const remainingSec = Math.max(0, resetsAtEpochSec - currentEpochSec);
  const days = Math.floor(remainingSec / 86400);
  const hours = Math.floor((remainingSec % 86400) / 3600);
  const minutes = Math.floor((remainingSec % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export class MeterReader {
  private db: TokenPalDatabase;
  private latestReading: MeterReading | null = null;
  private lastReportedModel: string | null = null;
  private modelMultiplierText: string;

  constructor(db: TokenPalDatabase, options: MeterReaderOptions = {}) {
    this.db = db;
    this.modelMultiplierText = options.modelMultiplierText || "Astra uses roughly 2 to 3x Sol's allowance (estimate)";

    // Restore latest snapshot from SQLite if available
    const existing = this.db.getLatestMeterSnapshot();
    if (existing) {
      this.latestReading = {
        sessionId: existing.session_id || undefined,
        ts: existing.ts,
        usedPercent: existing.used_percent,
        windowMinutes: existing.window_minutes,
        resetsAt: existing.resets_at,
        planType: existing.plan_type || undefined
      };
    }
  }

  public getLatestReading(): MeterReading | null {
    return this.latestReading;
  }

  /**
   * Process a meter reading:
   * 1. Uses the event with the latest timestamp across all sessions.
   * 2. Detects resets (resets_at changes or value drops to 0 with a later resets_at, or drop > 2 points).
   * 3. Ignores small downward jitter (1 to 2 points) unless resets_at changed or value fell to 0.
   * 4. Stores meter snapshots and resets in SQLite.
   */
  public processReading(reading: MeterReading): {
    snapshotStored: boolean;
    resetDetected: boolean;
    reset?: QuotaReset;
    modelSwitched?: boolean;
    modelSwitchNotice?: string;
  } {
    let recordedReset: QuotaReset | undefined;

    if (!this.latestReading) {
      this.latestReading = reading;
      this.db.insertMeterSnapshot({
        session_id: reading.sessionId,
        ts: reading.ts,
        used_percent: reading.usedPercent,
        window_minutes: reading.windowMinutes,
        resets_at: reading.resetsAt,
        plan_type: reading.planType
      });
      return { snapshotStored: true, resetDetected: false };
    }

    // Timestamp check: Use the event with the latest timestamp across all sessions
    const readingTime = new Date(reading.ts).getTime();
    const latestTime = new Date(this.latestReading.ts).getTime();
    if (!isNaN(readingTime) && !isNaN(latestTime) && readingTime < latestTime) {
      return { snapshotStored: false, resetDetected: false };
    }

    // Check reset conditions
    const resetsAtChanged = Math.abs(reading.resetsAt - this.latestReading.resetsAt) > 60;
    const fellToZero = reading.usedPercent === 0 && this.latestReading.usedPercent > 0;
    const dropGreaterThanTwo = (this.latestReading.usedPercent - reading.usedPercent) > 2.0;

    const isReset = resetsAtChanged || fellToZero || dropGreaterThanTwo;

    if (isReset) {
      const readingEpochSec = Math.floor(new Date(reading.ts).getTime() / 1000);
      const isEarly = readingEpochSec < (this.latestReading.resetsAt - 60);

      recordedReset = {
        ts: reading.ts,
        prev_used_percent: this.latestReading.usedPercent,
        prev_resets_at: this.latestReading.resetsAt,
        new_resets_at: reading.resetsAt,
        is_early: isEarly ? 1 : 0
      };

      this.db.insertQuotaReset(recordedReset);
      this.latestReading = reading;
      this.db.insertMeterSnapshot({
        session_id: reading.sessionId,
        ts: reading.ts,
        used_percent: reading.usedPercent,
        window_minutes: reading.windowMinutes,
        resets_at: reading.resetsAt,
        plan_type: reading.planType
      });
      return { snapshotStored: true, resetDetected: true, reset: recordedReset };
    }

    // Normal progression in same window
    if (reading.usedPercent >= this.latestReading.usedPercent) {
      this.latestReading = reading;
      this.db.insertMeterSnapshot({
        session_id: reading.sessionId,
        ts: reading.ts,
        used_percent: reading.usedPercent,
        window_minutes: reading.windowMinutes,
        resets_at: reading.resetsAt,
        plan_type: reading.planType
      });
      return { snapshotStored: true, resetDetected: false };
    }

    // Downward movement: if 1 to 2 points jitter, ignore
    if (this.latestReading.usedPercent - reading.usedPercent <= 2.0) {
      return { snapshotStored: false, resetDetected: false };
    }

    return { snapshotStored: false, resetDetected: false };
  }

  /**
   * Tracks model switches and produces a one-time notice on model change.
   */
  public checkModelSwitch(newModel?: string | null): { modelSwitched: boolean; notice?: string } {
    if (!newModel) return { modelSwitched: false };
    if (this.lastReportedModel && this.lastReportedModel.toLowerCase() !== newModel.toLowerCase()) {
      const isAstra = newModel.toLowerCase().includes('astra');
      const notice = isAstra
        ? `Model switched to ${newModel}. ${this.modelMultiplierText}`
        : `Model switched to ${newModel}.`;
      this.lastReportedModel = newModel;
      return { modelSwitched: true, notice };
    }
    this.lastReportedModel = newModel;
    return { modelSwitched: false };
  }

  /**
   * Generates formatted meter status for display and overlay
   */
  public getMeterStatus(activeModel?: string | null, customNowEpoch?: number): MeterStatus | null {
    if (!this.latestReading) {
      const snap = this.db.getLatestMeterSnapshot();
      if (!snap) return null;
      this.latestReading = {
        sessionId: snap.session_id || undefined,
        ts: snap.ts,
        usedPercent: snap.used_percent,
        windowMinutes: snap.window_minutes,
        resetsAt: snap.resets_at,
        planType: snap.plan_type || undefined
      };
    }

    const currentEpoch = customNowEpoch ?? Math.floor(Date.now() / 1000);
    const reading = this.latestReading;
    const percentBar = formatPercentBar(reading.usedPercent);
    const timeToResetFormatted = formatRemainingTime(reading.resetsAt, currentEpoch);

    // Count early resets in the last 7 days
    const sevenDaysAgo = new Date((currentEpoch - 7 * 86400) * 1000).toISOString();
    const earlyResetsCount = this.db.getEarlyResetCount(sevenDaysAgo);
    const earlyResetsNote = earlyResetsCount > 0
      ? `Window has reset early ${earlyResetsCount} time${earlyResetsCount > 1 ? 's' : ''} recently`
      : undefined;

    // Projection calculation using last 4 hours
    const fourHoursAgo = new Date((currentEpoch - 4 * 3600) * 1000).toISOString();
    const recentSnapshots = this.db.getRecentMeterSnapshots(fourHoursAgo);
    const projection = calculateProjection(recentSnapshots, reading, 3.0);

    const modelToUse = activeModel || this.lastReportedModel;
    const isAstra = modelToUse ? modelToUse.toLowerCase().includes('astra') : false;
    const modelBadgeText = isAstra ? this.modelMultiplierText : undefined;

    return {
      usedPercent: reading.usedPercent,
      windowMinutes: reading.windowMinutes,
      resetsAt: reading.resetsAt,
      planType: reading.planType || 'prolite',
      timeToResetFormatted,
      percentBar,
      earlyResetsCount,
      earlyResetsNote,
      projectedExhaustionHours: projection?.hoursToExhaustion,
      projectedExhaustionText: projection?.projectedExhaustionText,
      activeModel: modelToUse,
      modelBadgeText
    };
  }
}
