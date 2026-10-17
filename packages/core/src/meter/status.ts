import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TokenPalDatabase } from '../db/database.js';
import { MeterReader, formatLocalTime } from './meter-reader.js';
import { MeterReading } from '../types.js';

export interface MeterStatusSummary {
  usedPercent: number;
  percentBar: string;
  timeToResetFormatted: string;
  resetsAtEpochSec: number;
  resetsAtIso: string;
  resetsAtLocal: string;
  planType: string;
  lastReset: {
    ts: string;
    tsLocal: string;
    prevUsedPercent: number | null;
    newResetsAt: number;
    isEarly: boolean;
  } | null;
  earlyResetsCount: number;
  earlyResetsNote?: string;
  projectedExhaustionText?: string;
  modelBadgeText?: string;
  latestEventTs: string;
  asOfLocal: string;
  isStale: boolean;
  staleReason?: string;
  sessionsScannedCount: number;
}

export interface ReadLatestMeterStatusOptions {
  sessionsDir?: string;
  db?: TokenPalDatabase;
  maxRecentFiles?: number;
}

/**
 * Recursively find .jsonl session files in a base directory.
 */
function findSessionFiles(baseDir: string): string[] {
  const results: string[] = [];
  const walk = (d: string, depth = 0) => {
    if (depth > 6) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.isFile() && (e.name.endsWith('.jsonl') || e.name.startsWith('rollout-'))) {
        results.push(full);
      }
    }
  };
  walk(baseDir);
  return results;
}

/**
 * Reads rate limit meter state from recent session logs in sessionsDir,
 * processing readings chronologically to identify the latest meter state,
 * quota resets, and early-reset frequency.
 */
export async function readLatestMeterStatus(
  options: ReadLatestMeterStatusOptions = {}
): Promise<MeterStatusSummary | null> {
  const sessionsDir = options.sessionsDir || path.join(os.homedir(), '.codex', 'sessions');
  const maxFiles = options.maxRecentFiles ?? 100;
  const db = options.db || new TokenPalDatabase(':memory:');

  if (!fs.existsSync(sessionsDir)) {
    // If no directory, fallback to existing DB snapshot if available
    const latestSnapshot = db.getLatestMeterSnapshot();
    if (!latestSnapshot) return null;
    const reader = new MeterReader(db);
    const status = reader.getMeterStatus();
    if (!status) return null;
    const resets = db.getRecentQuotaResets(1);
    const last = resets.length > 0 ? resets[0] : null;
    return {
      usedPercent: status.usedPercent,
      percentBar: status.percentBar,
      timeToResetFormatted: status.timeToResetFormatted,
      resetsAtEpochSec: status.resetsAt,
      resetsAtIso: new Date(status.resetsAt * 1000).toISOString(),
      resetsAtLocal: status.resetsAtLocal || formatLocalTime(status.resetsAt),
      planType: status.planType,
      lastReset: last ? {
        ts: last.ts,
        tsLocal: formatLocalTime(last.ts),
        prevUsedPercent: last.prev_used_percent,
        newResetsAt: last.new_resets_at,
        isEarly: Boolean(last.is_early)
      } : null,
      earlyResetsCount: status.earlyResetsCount,
      earlyResetsNote: status.earlyResetsNote,
      projectedExhaustionText: status.projectedExhaustionText,
      modelBadgeText: status.modelBadgeText,
      latestEventTs: latestSnapshot.ts,
      asOfLocal: status.asOfLocal || formatLocalTime(latestSnapshot.ts),
      isStale: Boolean(status.isStale),
      staleReason: status.staleReason,
      sessionsScannedCount: 0
    };
  }

  const allFiles = findSessionFiles(sessionsDir);
  if (allFiles.length === 0) {
    return null;
  }

  // Sort files chronologically by filename / path
  allFiles.sort();
  const selectedFiles = allFiles.length > maxFiles ? allFiles.slice(-maxFiles) : allFiles;

  const readings: MeterReading[] = [];

  for (const filePath of selectedFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    if (!content.includes('token_count')) continue;

    const lines = content.split('\n');
    let fileSessionId: string | undefined;

    for (const line of lines) {
      if (!line.includes('token_count') && !line.includes('session_meta')) continue;
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed);
        const payload = event.payload || {};

        if (event.type === 'session_meta' && payload.session_id) {
          fileSessionId = payload.session_id;
        }

        if (event.type === 'event_msg' && payload.type === 'token_count') {
          const rl = payload.rate_limits?.primary;
          if (rl && typeof rl.used_percent === 'number' && typeof rl.resets_at === 'number' && typeof rl.window_minutes === 'number') {
            const ts = event.timestamp || payload.timestamp || new Date().toISOString();
            readings.push({
              sessionId: payload.session_id || fileSessionId,
              ts,
              usedPercent: rl.used_percent,
              windowMinutes: rl.window_minutes,
              resetsAt: rl.resets_at,
              planType: payload.rate_limits?.plan_type || 'prolite'
            });
          }
        }
      } catch {
        // ignore malformed lines
      }
    }
  }

  if (readings.length === 0) {
    return null;
  }

  // Sort readings strictly chronologically by timestamp
  readings.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const reader = new MeterReader(db);
  for (const r of readings) {
    reader.processReading(r);
  }

  const status = reader.getMeterStatus();
  if (!status) return null;

  const recentResets = db.getRecentQuotaResets(1);
  const lastReset = recentResets.length > 0 ? recentResets[0] : null;
  const latestEvent = readings[readings.length - 1];

  return {
    usedPercent: status.usedPercent,
    percentBar: status.percentBar,
    timeToResetFormatted: status.timeToResetFormatted,
    resetsAtEpochSec: status.resetsAt,
    resetsAtIso: new Date(status.resetsAt * 1000).toISOString(),
    resetsAtLocal: status.resetsAtLocal || formatLocalTime(status.resetsAt),
    planType: status.planType,
    lastReset: lastReset ? {
      ts: lastReset.ts,
      tsLocal: formatLocalTime(lastReset.ts),
      prevUsedPercent: lastReset.prev_used_percent,
      newResetsAt: lastReset.new_resets_at,
      isEarly: Boolean(lastReset.is_early)
    } : null,
    earlyResetsCount: status.earlyResetsCount,
    earlyResetsNote: status.earlyResetsNote,
    projectedExhaustionText: status.projectedExhaustionText,
    modelBadgeText: status.modelBadgeText,
    latestEventTs: latestEvent.ts,
    asOfLocal: status.asOfLocal || formatLocalTime(latestEvent.ts),
    isStale: Boolean(status.isStale),
    staleReason: status.staleReason,
    sessionsScannedCount: selectedFiles.length
  };
}
