import { MeterSnapshot } from '../types.js';
import { ProjectionResult } from './types.js';

/**
 * Calculates projected quota exhaustion time:
 * - Uses only the last few hours of meter movement within the current reset window.
 * - Requires at least a 3-point rise (deltaUsedPercent >= 3.0) before showing any projection.
 * - Labels output as a rough estimate.
 * - Does NOT base calculation on time elapsed in the window.
 */
export function calculateProjection(
  snapshots: MeterSnapshot[],
  currentReading: { usedPercent: number; resetsAt: number; ts: string },
  minRisePoints = 3.0
): ProjectionResult | null {
  if (!snapshots || snapshots.length < 2) {
    return null;
  }

  // Filter snapshots belonging to the current reset window
  const inWindow = snapshots.filter(s => s.resets_at === currentReading.resetsAt);
  if (inWindow.length < 2) {
    return null;
  }

  // Sort chronologically
  const sorted = [...inWindow].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const earliest = sorted[0];
  const latestTs = new Date(currentReading.ts).getTime();
  const earliestTs = new Date(earliest.ts).getTime();

  const deltaTimeHours = (latestTs - earliestTs) / (3600 * 1000);
  const deltaUsed = currentReading.usedPercent - earliest.used_percent;

  // Strict requirement: at least a 3-point rise and reasonable time span (at least 5 minutes)
  if (deltaUsed < minRisePoints || deltaTimeHours < (5 / 60)) {
    return null;
  }

  const ratePerHour = deltaUsed / deltaTimeHours;
  if (ratePerHour <= 0) {
    return null;
  }

  const remainingPercent = Math.max(0, 100 - currentReading.usedPercent);
  const hoursToExhaustion = remainingPercent / ratePerHour;

  const currentEpochSec = Math.floor(latestTs / 1000);
  const projectedExhaustionTimestamp = Math.floor(currentEpochSec + hoursToExhaustion * 3600);
  const isBeforeReset = projectedExhaustionTimestamp < currentReading.resetsAt;

  const hoursRounded = Math.round(hoursToExhaustion);
  const timeDisplay = hoursRounded >= 48
    ? `${Math.round(hoursRounded / 24)}d`
    : `${hoursRounded}h`;

  const projectedExhaustionText = `Rough estimate: quota exhaustion in ~${timeDisplay}`;

  return {
    hoursToExhaustion,
    projectedExhaustionTimestamp,
    projectedExhaustionText,
    isBeforeReset
  };
}
