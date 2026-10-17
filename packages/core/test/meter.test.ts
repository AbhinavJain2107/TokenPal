import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { TokenPalDatabase } from '../src/db/database.js';
import { MeterReader, formatPercentBar, formatRemainingTime } from '../src/meter/meter-reader.js';
import { calculateProjection } from '../src/meter/projection.js';
import { RequestCostTracker } from '../src/meter/request-cost.js';
import { MeterAlertManager } from '../src/meter/alerts.js';
import { CodexAdapter } from '../src/adapters/codex.js';
import { readLatestMeterStatus } from '../src/meter/status.js';
import { MeterReading, MeterSnapshot } from '../src/types.js';

describe('Rate Limit Meter Redesign', () => {
  let db: TokenPalDatabase;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenpal-meter-test-'));
    dbPath = path.join(tempDir, 'test.sqlite');
    db = new TokenPalDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('1. Meter Reader & Reset Detection', () => {
    it('ingests meter readings and stores snapshots in SQLite', () => {
      const reader = new MeterReader(db);
      const res = reader.processReading({
        sessionId: 'sess-1',
        ts: '2026-10-16T10:00:00Z',
        usedPercent: 25,
        windowMinutes: 10080,
        resetsAt: 1792740000,
        planType: 'prolite'
      });

      expect(res.snapshotStored).toBe(true);
      expect(res.resetDetected).toBe(false);

      const latest = db.getLatestMeterSnapshot();
      expect(latest).toBeDefined();
      expect(latest?.used_percent).toBe(25);
      expect(latest?.plan_type).toBe('prolite');
    });

    it('stores a snapshot only when used_percent, resets_at, or plan_type changes', () => {
      const reader = new MeterReader(db);
      // Initial reading writes snapshot
      const r1 = reader.processReading({
        sessionId: 'sess-1',
        ts: '2026-10-16T10:00:00Z',
        usedPercent: 20,
        windowMinutes: 10080,
        resetsAt: 1792740000,
        planType: 'prolite'
      });
      expect(r1.snapshotStored).toBe(true);

      // Duplicate reading with identical values does NOT write snapshot
      const r2 = reader.processReading({
        sessionId: 'sess-1',
        ts: '2026-10-16T10:01:00Z',
        usedPercent: 20,
        windowMinutes: 10080,
        resetsAt: 1792740000,
        planType: 'prolite'
      });
      expect(r2.snapshotStored).toBe(false);

      // Changed used_percent writes snapshot
      const r3 = reader.processReading({
        sessionId: 'sess-1',
        ts: '2026-10-16T10:02:00Z',
        usedPercent: 22,
        windowMinutes: 10080,
        resetsAt: 1792740000,
        planType: 'prolite'
      });
      expect(r3.snapshotStored).toBe(true);

      // Changed plan_type writes snapshot
      const r4 = reader.processReading({
        sessionId: 'sess-1',
        ts: '2026-10-16T10:03:00Z',
        usedPercent: 22,
        windowMinutes: 10080,
        resetsAt: 1792740000,
        planType: 'pro'
      });
      expect(r4.snapshotStored).toBe(true);

      const allSnapshots = db.getRecentMeterSnapshots('2026-10-16T00:00:00Z', 100);
      expect(allSnapshots.length).toBe(3);
    });

    it('ignores small downward jitter (1-2 points) when resets_at is unchanged and value > 0', () => {
      const reader = new MeterReader(db);
      reader.processReading({
        sessionId: 'sess-1',
        ts: '2026-10-16T10:00:00Z',
        usedPercent: 50,
        windowMinutes: 10080,
        resetsAt: 1792740000
      });

      // 1 point jitter down
      const jitter1 = reader.processReading({
        sessionId: 'sess-2',
        ts: '2026-10-16T10:01:00Z',
        usedPercent: 49,
        windowMinutes: 10080,
        resetsAt: 1792740000
      });
      expect(jitter1.snapshotStored).toBe(false);
      expect(jitter1.resetDetected).toBe(false);
      expect(reader.getLatestReading()?.usedPercent).toBe(50);

      // 2 points jitter down
      const jitter2 = reader.processReading({
        sessionId: 'sess-1',
        ts: '2026-10-16T10:02:00Z',
        usedPercent: 48,
        windowMinutes: 10080,
        resetsAt: 1792740000
      });
      expect(jitter2.snapshotStored).toBe(false);
      expect(jitter2.resetDetected).toBe(false);
      expect(reader.getLatestReading()?.usedPercent).toBe(50);
    });

    it('detects reset when resets_at changes', () => {
      const reader = new MeterReader(db);
      reader.processReading({
        sessionId: 'sess-1',
        ts: '2026-10-16T10:00:00Z',
        usedPercent: 70,
        windowMinutes: 10080,
        resetsAt: 1792740000
      });

      // Window rolled over to new resetsAt
      const resetRes = reader.processReading({
        sessionId: 'sess-1',
        ts: '2026-10-16T12:00:00Z',
        usedPercent: 0,
        windowMinutes: 10080,
        resetsAt: 1793344800
      });

      expect(resetRes.resetDetected).toBe(true);
      expect(resetRes.reset).toBeDefined();
      expect(resetRes.reset?.prev_used_percent).toBe(70);
      expect(resetRes.reset?.new_resets_at).toBe(1793344800);

      const resets = db.getRecentQuotaResets('2026-10-16T00:00:00Z');
      expect(resets.length).toBe(1);
    });

    it('detects reset when value drops to 0 even if resets_at is same or later', () => {
      const reader = new MeterReader(db);
      reader.processReading({
        sessionId: 'sess-1',
        ts: '2026-10-16T10:00:00Z',
        usedPercent: 15,
        windowMinutes: 10080,
        resetsAt: 1792740000
      });

      const dropRes = reader.processReading({
        sessionId: 'sess-1',
        ts: '2026-10-16T10:30:00Z',
        usedPercent: 0,
        windowMinutes: 10080,
        resetsAt: 1792740000
      });

      expect(dropRes.resetDetected).toBe(true);
      expect(dropRes.reset?.prev_used_percent).toBe(15);
    });

    it('marks reset as early when timestamp is before scheduled resets_at', () => {
      const reader = new MeterReader(db);
      const scheduledResetEpoch = Math.floor(new Date('2026-10-20T10:00:00Z').getTime() / 1000);

      reader.processReading({
        sessionId: 'sess-1',
        ts: '2026-10-16T10:00:00Z',
        usedPercent: 80,
        windowMinutes: 10080,
        resetsAt: scheduledResetEpoch
      });

      // Reset fires early on Oct 17
      const resetRes = reader.processReading({
        sessionId: 'sess-1',
        ts: '2026-10-17T10:00:00Z',
        usedPercent: 0,
        windowMinutes: 10080,
        resetsAt: scheduledResetEpoch + 10080 * 60
      });

      expect(resetRes.resetDetected).toBe(true);
      expect(resetRes.reset?.is_early).toBe(1);
    });
  });

  describe('2. Display Formatting', () => {
    it('formats percent bar and remaining time', () => {
      const bar = formatPercentBar(50, 10);
      expect(bar).toContain('50%');
      expect(bar).toContain('█████');

      const remainingTime = formatRemainingTime(1000 + 86400 * 2 + 3600 * 4, 1000);
      expect(remainingTime).toBe('2d 4h');
    });

    it('shows early resets note when window reset early recently', () => {
      // Record an early reset
      db.insertQuotaReset({
        ts: '2026-10-16T10:00:00Z',
        prev_used_percent: 60,
        prev_resets_at: 1792740000,
        new_resets_at: 1793344800,
        is_early: 1
      });

      const reader = new MeterReader(db);
      reader.processReading({
        ts: '2026-10-16T11:00:00Z',
        usedPercent: 5,
        windowMinutes: 10080,
        resetsAt: 1793344800,
        planType: 'prolite'
      });

      const fixedNowEpoch = Math.floor(new Date('2026-10-16T12:00:00Z').getTime() / 1000);
      const status = reader.getMeterStatus(undefined, fixedNowEpoch);
      expect(status?.earlyResetsCount).toBe(1);
      expect(status?.earlyResetsNote).toContain('Window has reset early 1 time recently');
    });
  });

  describe('3. Projection Calculation', () => {
    it('requires at least a 3-point rise before returning any projection', () => {
      const resetsAt = 1792740000;
      const snapshots: MeterSnapshot[] = [
        { ts: '2026-10-16T10:00:00Z', used_percent: 10, window_minutes: 10080, resets_at: resetsAt },
        { ts: '2026-10-16T11:00:00Z', used_percent: 12, window_minutes: 10080, resets_at: resetsAt } // only 2-point rise
      ];

      const current = { usedPercent: 12, resetsAt, ts: '2026-10-16T11:00:00Z' };
      const proj = calculateProjection(snapshots, current, 3.0);
      expect(proj).toBeNull();
    });

    it('calculates rough estimate when rise is >= 3 points within recent hours', () => {
      const resetsAt = Math.floor(new Date('2026-10-20T10:00:00Z').getTime() / 1000);
      const snapshots: MeterSnapshot[] = [
        { ts: '2026-10-16T10:00:00Z', used_percent: 10, window_minutes: 10080, resets_at: resetsAt },
        { ts: '2026-10-16T12:00:00Z', used_percent: 20, window_minutes: 10080, resets_at: resetsAt } // 10 points in 2 hours = 5%/hr
      ];

      const current = { usedPercent: 20, resetsAt, ts: '2026-10-16T12:00:00Z' };
      const proj = calculateProjection(snapshots, current, 3.0);
      expect(proj).toBeDefined();
      expect(proj?.projectedExhaustionText).toContain('Rough estimate');
      // Remaining: 80% at 5%/hr = 16 hours
      expect(Math.round(proj!.hoursToExhaustion)).toBe(16);
      expect(proj?.isBeforeReset).toBe(true);
    });
  });

  describe('4. Per-Request Cost Tracking', () => {
    it('shows <1% for requests with under 1% meter change', () => {
      const tracker = new RequestCostTracker();
      const meter1: MeterReading = { ts: '2026-10-16T10:00:00Z', usedPercent: 20, windowMinutes: 10080, resetsAt: 1792740000 };
      const meter2: MeterReading = { ts: '2026-10-16T10:01:00Z', usedPercent: 20, windowMinutes: 10080, resetsAt: 1792740000 };

      tracker.onTaskStarted('turn-1', '2026-10-16T10:00:00Z', meter1, 'gpt-6-astra');
      tracker.recordCall('turn-1', 15000);
      const cost = tracker.onTaskComplete('turn-1', '2026-10-16T10:01:00Z', meter2);

      expect(cost).toBeDefined();
      expect(cost?.costDisplay).toBe('<1%');
      expect(cost?.deltaPercent).toBe(0);
      expect(cost?.spannedReset).toBe(false);
    });

    it('shows about +N% for requests with measurable meter change', () => {
      const tracker = new RequestCostTracker();
      const meter1: MeterReading = { ts: '2026-10-16T10:00:00Z', usedPercent: 20, windowMinutes: 10080, resetsAt: 1792740000 };
      const meter2: MeterReading = { ts: '2026-10-16T10:05:00Z', usedPercent: 24, windowMinutes: 10080, resetsAt: 1792740000 };

      tracker.onTaskStarted('turn-2', '2026-10-16T10:00:00Z', meter1);
      const cost = tracker.onTaskComplete('turn-2', '2026-10-16T10:05:00Z', meter2);

      expect(cost).toBeDefined();
      expect(cost?.costDisplay).toBe('about +4%');
      expect(cost?.deltaPercent).toBe(4);
    });

    it('skips cost display if the request spans a quota reset', () => {
      const tracker = new RequestCostTracker();
      const meter1: MeterReading = { ts: '2026-10-16T10:00:00Z', usedPercent: 85, windowMinutes: 10080, resetsAt: 1792740000 };
      const meter2: MeterReading = { ts: '2026-10-16T10:05:00Z', usedPercent: 0, windowMinutes: 10080, resetsAt: 1793344800 };

      tracker.onTaskStarted('turn-3', '2026-10-16T10:00:00Z', meter1);
      const cost = tracker.onTaskComplete('turn-3', '2026-10-16T10:05:00Z', meter2);

      expect(cost).toBeDefined();
      expect(cost?.spannedReset).toBe(true);
    });
  });

  describe('5. Model Badge and Switching', () => {
    it('returns persistent configurable badge text for Astra model', () => {
      const reader = new MeterReader(db, {
        modelMultiplierText: "Astra uses roughly 2 to 3x Sol's allowance (estimate)"
      });

      reader.processReading({
        ts: '2026-10-16T10:00:00Z',
        usedPercent: 30,
        windowMinutes: 10080,
        resetsAt: 1792740000
      });

      const status = reader.getMeterStatus('gpt-6-astra');
      expect(status?.modelBadgeText).toBe("Astra uses roughly 2 to 3x Sol's allowance (estimate)");
    });

    it('generates a one-time notice on switching models without yellow alert state', () => {
      const reader = new MeterReader(db);
      reader.checkModelSwitch('gpt-6-sol');

      const switchResult = reader.checkModelSwitch('gpt-6-astra');
      expect(switchResult.modelSwitched).toBe(true);
      expect(switchResult.notice).toContain('Model switched to gpt-6-astra');
      expect(switchResult.notice).toContain("Astra uses roughly 2 to 3x Sol's allowance (estimate)");

      // Second check with same model should not produce notice
      const sameModel = reader.checkModelSwitch('gpt-6-astra');
      expect(sameModel.modelSwitched).toBe(false);
    });
  });

  describe('6. Alerts and Cooldown', () => {
    it('fires alert on single request over ~3% and respects 1-hour cooldown', () => {
      const alertManager = new MeterAlertManager({ cooldownMs: 3600 * 1000, singleRequestThresholdPercent: 3.0 });
      const now = 1792135600000;

      const costHigh = {
        turnId: 'turn-1',
        startTs: '2026-10-16T10:00:00Z',
        completeTs: '2026-10-16T10:05:00Z',
        startUsedPercent: 10,
        endUsedPercent: 14,
        deltaPercent: 4.0,
        costDisplay: 'about +4%',
        spannedReset: false,
        callsCount: 2,
        tokensCount: 30000
      };

      const alert1 = alertManager.checkRequestCost(costHigh, null, now);
      expect(alert1).toBeDefined();
      expect(alert1?.rule).toBe('single_request_high');
      expect(alert1?.state).toBe('yellow');

      // Attempt second alert within 1 hour -> suppressed by cooldown
      const alert2 = alertManager.checkRequestCost(costHigh, null, now + 1800 * 1000); // 30 min later
      expect(alert2).toBeNull();

      // After 1 hour -> fires again
      const alert3 = alertManager.checkRequestCost(costHigh, null, now + 3700 * 1000); // 61 min later
      expect(alert3).toBeDefined();
    });
  });

  describe('7. Redacted Fixture Integration', () => {
    it('parses codex-meter-sample.jsonl and extracts rate limits, task events, and reset', async () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'codex-meter-sample.jsonl');
      const adapter = new CodexAdapter();
      const parseResult = await adapter.parseIncremental(fixturePath, 0);

      expect(parseResult.meterReadings).toBeDefined();
      expect(parseResult.meterReadings?.length).toBeGreaterThanOrEqual(4);

      expect(parseResult.taskEvents).toBeDefined();
      expect(parseResult.taskEvents?.some(t => t.type === 'task_started')).toBe(true);
      expect(parseResult.taskEvents?.some(t => t.type === 'task_complete')).toBe(true);

      // Verify meter reader processing of entire fixture
      const reader = new MeterReader(db);
      let resetObserved = false;

      for (const reading of parseResult.meterReadings!) {
        const res = reader.processReading(reading);
        if (res.resetDetected) {
          resetObserved = true;
        }
      }

      expect(resetObserved).toBe(true);
    });
  });

  describe('8. Status Reader Integration', () => {
    it('returns null when directory does not exist or has no session files', async () => {
      const nonExistentDir = path.join(tempDir, 'does-not-exist');
      const status = await readLatestMeterStatus({ sessionsDir: nonExistentDir, db });
      expect(status).toBeNull();
    });

    it('reads the latest meter event, resets, and early-reset counts from session files', async () => {
      const sessionsDir = path.join(tempDir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Create session file 1 with an initial reading and an early reset
      const file1 = path.join(sessionsDir, 'rollout-2026-10-15T10-00-00-test1.jsonl');
      const lines1 = [
        JSON.stringify({ type: 'session_meta', payload: { session_id: 's-1' } }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-10-15T10:00:00.000Z',
          payload: {
            type: 'token_count',
            rate_limits: {
              primary: { used_percent: 85, window_minutes: 10080, resets_at: 1792582594 },
              plan_type: 'prolite'
            }
          }
        }),
        // Early reset to 0 with new window resets_at
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-10-15T12:00:00.000Z',
          payload: {
            type: 'token_count',
            rate_limits: {
              primary: { used_percent: 0, window_minutes: 10080, resets_at: 1792649587 },
              plan_type: 'prolite'
            }
          }
        })
      ];
      fs.writeFileSync(file1, lines1.join('\n'));

      // Create session file 2 with latest progress
      const file2 = path.join(sessionsDir, 'rollout-2026-10-16T08-00-00-test2.jsonl');
      const lines2 = [
        JSON.stringify({ type: 'session_meta', payload: { session_id: 's-2' } }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-10-16T08:00:00.000Z',
          payload: {
            type: 'token_count',
            rate_limits: {
              primary: { used_percent: 12, window_minutes: 10080, resets_at: 1792649587 },
              plan_type: 'prolite'
            }
          }
        })
      ];
      fs.writeFileSync(file2, lines2.join('\n'));

      const status = await readLatestMeterStatus({ sessionsDir, db });
      expect(status).not.toBeNull();
      expect(status!.usedPercent).toBe(12);
      expect(status!.planType).toBe('prolite');
      expect(status!.resetsAtEpochSec).toBe(1792649587);
      expect(status!.resetsAtIso).toBe(new Date(1792649587 * 1000).toISOString());
      expect(status!.lastReset).not.toBeNull();
      expect(status!.lastReset?.prevUsedPercent).toBe(85);
      expect(status!.lastReset?.isEarly).toBe(true);
      expect(status!.earlyResetsCount).toBe(1);
      expect(status!.latestEventTs).toBe('2026-10-16T08:00:00.000Z');
      expect(status!.sessionsScannedCount).toBe(2);
    });
  });
});
