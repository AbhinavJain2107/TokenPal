#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as net from 'node:net';
import {
  TokenPalDatabase,
  SessionWatcher,
  replaySessionFile,
  CodexAdapter,
  RulesEngine,
  loadRuleThresholds,
  generateLayerAHandoff,
  MeterAlertManager,
  OverlayLauncher,
  OverlayAlertPayload,
  readLatestMeterStatus,
  getAllDemoStates,
  DaemonManager,
  enableAutostart,
  disableAutostart,
  writePidFileAtomic,
  DAEMON_FLAG_MARKER
} from 'tokenpal-core';

const program = new Command();
let staleNotice: string | null = null;
const daemonManager = new DaemonManager({
  onStalePid: (pid: number, reason: string) => {
    staleNotice = `Removed stale PID file (pid ${pid}: ${reason}).`;
  }
});

program
  .name('tokenpal')
  .description('Proactive Context and Token Guardian for AI Coding Agents')
  .version('0.1.0');

/**
 * Runs the watcher process in the foreground with clean signal and PID handling.
 */
async function runWatcherForeground(options: {
  dir?: string;
  db?: string;
  config?: string;
  ui?: boolean;
  legacyRules?: boolean;
}) {
  const dbPath = options.db || path.join(os.homedir(), '.tokenpal', 'tokenpal.sqlite');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Atomically write PID file with unique marker so status and stop can safely manage instances
  writePidFileAtomic(daemonManager.getPidFilePath(), process.pid, DAEMON_FLAG_MARKER);

  const thresholds = loadRuleThresholds(options.config);
  const engine = new RulesEngine(thresholds);
  const db = new TokenPalDatabase(dbPath);
  const customDirs = options.dir ? [path.resolve(options.dir)] : [];
  const watcher = new SessionWatcher({ db, customDirs, pollIntervalMs: 1000 });
  const alertManager = new MeterAlertManager();

  // Read latest real meter status from DB for initial overlay display
  const initialSnapshot = db.getLatestMeterSnapshot();
  const initialStatus = initialSnapshot ? watcher.getMeterReader().getMeterStatus() : null;
  const initialPayload: OverlayAlertPayload | undefined = initialStatus ? {
    state: initialStatus.isStale ? 'yellow' : 'green',
    meter: {
      usedPercent: initialStatus.usedPercent,
      timeToResetFormatted: initialStatus.timeToResetFormatted,
      resetsAtLocal: initialStatus.resetsAtLocal,
      asOfLocal: initialStatus.asOfLocal,
      isStale: initialStatus.isStale,
      staleReason: initialStatus.staleReason,
      planType: initialStatus.planType,
      percentBar: initialStatus.percentBar,
      earlyResetsCount: initialStatus.earlyResetsCount,
      earlyResetsNote: initialStatus.earlyResetsNote,
      projectedExhaustionText: initialStatus.projectedExhaustionText,
      modelBadgeText: initialStatus.modelBadgeText
    }
  } : undefined;

  const launcher = options.ui !== false ? new OverlayLauncher() : null;
  if (launcher) {
    launcher.start(initialPayload);
  }

  // Local control server for daemon IPC commands (e.g. tokenpal test-alert)
  const socketPath = daemonManager.getSocketPath();
  if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // ignore
    }
  }

  const controlServer = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const req = JSON.parse(line.trim());
          if (req.command === 'test-alert') {
            const currentStatus = watcher.getMeterReader().getMeterStatus();
            const testAlert: OverlayAlertPayload = {
              state: 'yellow',
              rule: 'test_alert',
              reason: 'TEST ALERT: Verification from running TokenPal daemon',
              advice: 'This is a test alert verifying desktop overlay activation via the background daemon control channel.',
              meter: currentStatus ? {
                usedPercent: currentStatus.usedPercent,
                percentBar: currentStatus.percentBar,
                resetsAtLocal: currentStatus.resetsAtLocal,
                timeToResetFormatted: currentStatus.timeToResetFormatted,
                planType: currentStatus.planType,
                projectedExhaustionText: currentStatus.projectedExhaustionText || 'Quota healthy'
              } : {
                usedPercent: 42,
                percentBar: '████░░░░░░',
                resetsAtLocal: 'Sunday, 12:00 PM',
                timeToResetFormatted: '2d 4h',
                planType: 'prolite',
                projectedExhaustionText: 'Test projection: quota healthy'
              }
            };
            if (launcher) {
              launcher.showAlert(testAlert);
            }
            socket.write(JSON.stringify({ status: 'ok', message: 'Test alert sent to overlay' }) + '\n');
          } else {
            socket.write(JSON.stringify({ status: 'unknown_command' }) + '\n');
          }
        } catch {
          socket.write(JSON.stringify({ status: 'error', error: 'Invalid JSON command' }) + '\n');
        }
      }
    });
  });

  controlServer.listen(socketPath, () => {
    // control server ready
  });
  controlServer.on('error', () => {
    // ignore socket bind errors
  });

  console.log('='.repeat(75));
  console.log(' TokenPal Guardian Watcher started (Rate Limit Meter Redesign Active)');
  console.log(` Process ID           : ${process.pid}`);
  console.log(` Watching directories : ${watcher.getWatchDirs().join(', ')}`);
  console.log(` Database             : ${dbPath}`);
  console.log(' Active Alerts        : Projected exhaustion before reset | Single request > 3%');
  console.log(' Cooldown             : Once per hour per alert type');
  console.log('='.repeat(75));

  // Show initial meter snapshot in console if present in database
  if (initialSnapshot && initialStatus) {
    if (launcher) {
      launcher.updateMeter(initialPayload!);
    }
    const resetPart = initialStatus.resetsAtLocal ? ` (${initialStatus.resetsAtLocal})` : '';
      const asOfPart = initialStatus.asOfLocal ? ` | as of ${initialStatus.asOfLocal}` : '';
      console.log(`\n[METER] ${initialStatus.percentBar} | Resets in ${initialStatus.timeToResetFormatted}${resetPart}${asOfPart} | Plan: ${initialStatus.planType}`);
      if (initialStatus.isStale && initialStatus.staleReason) {
        console.log(`        ⚠️  STALE: ${initialStatus.staleReason}`);
      }
      if (initialStatus.earlyResetsNote) {
        console.log(`        ⚠️  ${initialStatus.earlyResetsNote}`);
      }
      if (initialStatus.projectedExhaustionText) {
        console.log(`        ⏳ ${initialStatus.projectedExhaustionText}`);
      }
      if (initialStatus.modelBadgeText) {
        console.log(`        💡 ${initialStatus.modelBadgeText}`);
      }
      console.log('');
  }

  console.log('Listening for session turns in real time...\n');

  // Rate limit meter update listener
  watcher.on('meter', (status) => {
    const resetPart = status.resetsAtLocal ? ` (${status.resetsAtLocal})` : '';
    const asOfPart = status.asOfLocal ? ` | as of ${status.asOfLocal}` : '';
    console.log(`[METER] ${status.percentBar} | Resets in ${status.timeToResetFormatted}${resetPart}${asOfPart} | Plan: ${status.planType}`);
    if (status.isStale && status.staleReason) {
      console.log(`        ⚠️  STALE: ${status.staleReason}`);
    }
    if (status.earlyResetsNote) {
      console.log(`        ⚠️  ${status.earlyResetsNote}`);
    }
    if (status.projectedExhaustionText) {
      console.log(`        ⏳ ${status.projectedExhaustionText}`);
    }

    // Check projected exhaustion alert
    const alert = alertManager.checkProjectedExhaustion(status);
    if (alert) {
      console.log(`\n  🚨 ALERT [${alert.rule}]`);
      console.log(`  Reason : ${alert.reason}`);
      console.log(`  Action : ${alert.advice}\n`);

      try {
        db.insertAlert({
          id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          session_id: null,
          ts: new Date().toISOString(),
          rule: alert.rule || 'projected_exhaustion',
          severity: alert.state,
          shown: 1,
          action_taken: null
        });
      } catch (err: any) {
        console.error(`[WARN] Failed to record projected exhaustion alert in DB: ${err?.message || err} [context: rule=${alert.rule || 'projected_exhaustion'}, state=${alert.state}]`);
      }

      if (launcher) {
        launcher.showAlert(alert);
      }
    } else if (launcher) {
      launcher.updateMeter({
        state: status.isStale ? 'yellow' : 'green',
        meter: {
          usedPercent: status.usedPercent,
          timeToResetFormatted: status.timeToResetFormatted,
          resetsAtLocal: status.resetsAtLocal,
          asOfLocal: status.asOfLocal,
          isStale: status.isStale,
          staleReason: status.staleReason,
          planType: status.planType,
          percentBar: status.percentBar,
          earlyResetsCount: status.earlyResetsCount,
          earlyResetsNote: status.earlyResetsNote,
          projectedExhaustionText: status.projectedExhaustionText,
          modelBadgeText: status.modelBadgeText
        }
      });
    }
  });

  // Model switch notification
  watcher.on('model_switch', ({ notice }) => {
    console.log(`\n[NOTICE] ${notice}\n`);
    if (launcher) {
      launcher.updateMeter({
        state: 'green',
        notice,
        animationOverride: 'happy'
      });
    }
  });

  // Quota reset detected
  watcher.on('quota_reset', (reset) => {
    const earlyLabel = reset.is_early ? ' (EARLY RESET)' : '';
    console.log(`\n[RESET] Quota reset detected! Previous: ${reset.prev_used_percent ?? '?'}% -> New: 0%${earlyLabel}\n`);
  });

  // Request cost measured
  watcher.on('request_cost', (cost) => {
    if (cost.spannedReset) {
      console.log(`[COST] Turn ${cost.turnId}: Skipped (spanned quota reset)`);
    } else {
      console.log(
        `[COST] Turn ${cost.turnId}: ${cost.costDisplay} ` +
        `(${cost.callsCount} call${cost.callsCount !== 1 ? 's' : ''}, ${cost.tokensCount.toLocaleString()} tokens)`
      );

      // Check high single request cost alert (> ~3%)
      const currentStatus = watcher.getMeterReader().getMeterStatus(cost.model);
      const alert = alertManager.checkRequestCost(cost, currentStatus);
      if (alert) {
        console.log(`\n  ⚠️  ALERT [${alert.rule}]`);
        console.log(`  Reason : ${alert.reason}`);
        console.log(`  Action : ${alert.advice}\n`);

        try {
          db.insertAlert({
            id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            session_id: cost.sessionId || null,
            ts: new Date().toISOString(),
            rule: alert.rule || 'single_request_high',
            severity: alert.state,
            shown: 1,
            action_taken: null
          });
        } catch (err: any) {
          console.error(`[WARN] Failed to record request cost alert in DB: ${err?.message || err} [context: rule=${alert.rule || 'single_request_high'}, state=${alert.state}, turn=${cost.turnId}]`);
        }

        if (launcher) {
          launcher.showAlert(alert);
        }
      } else if (cost.costPercent && cost.costPercent >= 1.5) {
        if (launcher) {
          launcher.updateMeter({
            state: 'green',
            animationOverride: 'curious',
            meter: {
              usedPercent: currentStatus?.usedPercent ?? 0,
              timeToResetFormatted: currentStatus?.timeToResetFormatted ?? '',
              planType: currentStatus?.planType ?? 'prolite',
              requestCostDisplay: cost.costDisplay
            }
          });
        }
      }
    }
  });

  watcher.on('turn', (payload) => {
    const { session, turn, turnIndex, meterStatus } = payload;
    const shortId = session.id.slice(0, 8);
    const model = turn.model || 'unknown';
    const effort = turn.effort ? ` [${turn.effort}]` : '';
    const contextSize = turn.input_tokens.toLocaleString();
    const outputTok = turn.output_tokens.toLocaleString();
    const cachedTok = turn.cached_tokens.toLocaleString();

    const timeStr = new Date(turn.ts).toLocaleTimeString();
    const meterPart = meterStatus ? ` | Meter: ${Math.round(meterStatus.usedPercent)}%` : '';

    console.log(
      `[${timeStr}] Sess ${shortId} | Turn #${turnIndex.toString().padStart(2)} | ` +
      `Model: ${model}${effort} | ` +
      `Context: ${contextSize.padStart(7)} | ` +
      `Cached: ${cachedTok.padStart(6)} | ` +
      `Out: ${outputTok.padStart(5)}${meterPart}`
    );

    if (options.legacyRules) {
      const turns = db.getTurns(session.id);
      const tools = db.getToolEvents(session.id);
      const evalResult = engine.evaluate(session, turns, tools, true);
      if (evalResult.shouldAlert && evalResult.primaryAlert) {
        const alert = evalResult.primaryAlert;
        console.log(`  [Legacy Rule ${alert.rule}] ${alert.reason} -> ${alert.advice}`);
      }
    }
  });

  watcher.on('unsupported', ({ filePath, error }) => {
    console.warn(`[WARN] Unsupported log format in ${path.basename(filePath)}: ${error}`);
  });

  watcher.on('error', (err) => {
    console.error('[ERROR] Watcher encountered an error:', err);
  });

  await watcher.start();

  // Periodic log rotation check (cap at ~5 MB)
  const logRotateTimer = setInterval(() => {
    try {
      daemonManager.rotateLogs();
    } catch {
      // ignore
    }
  }, 60000);

  // Clean shutdown handling for both SIGINT and SIGTERM
  let isCleaningUp = false;
  const cleanShutdown = () => {
    if (isCleaningUp) return;
    isCleaningUp = true;
    clearInterval(logRotateTimer);
    try {
      controlServer.close();
      if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
    } catch {
      // ignore
    }
    console.log('\nStopping TokenPal watcher...');
    watcher.stop();
    if (launcher) {
      launcher.close();
    }
    db.close();
    daemonManager.cleanupPidOnExit();
    process.exit(0);
  };

  process.on('SIGINT', cleanShutdown);
  process.on('SIGTERM', cleanShutdown);
}

program
  .command('start')
  .description('Run TokenPal watcher in the background as a detached daemon')
  .option('-d, --dir <path>', 'Custom directory to watch for session logs')
  .option('--db <path>', 'Path to SQLite database', path.join(os.homedir(), '.tokenpal', 'tokenpal.sqlite'))
  .option('--config <path>', 'Path to custom config.json')
  .option('--ui', 'Launch desktop overlay mascot during alerts')
  .option('--no-ui', 'Disable desktop overlay mascot during alerts')
  .option('--legacy-rules', 'Enable retired context growth alerts (off by default)')
  .option('--foreground', 'Run watcher directly in the terminal (foreground mode)')
  .option('--tokenpal-daemon', 'Internal marker indicating daemon process')
  .action(async (options) => {
    if (options.foreground) {
      const currentStatus = daemonManager.getStatus();
      if (currentStatus.running && currentStatus.pid !== process.pid) {
        console.log(`TokenPal daemon is already running (pid ${currentStatus.pid}).`);
        process.exit(0);
      }
      await runWatcherForeground(options);
      return;
    }

    const result = await daemonManager.start({
      ui: options.ui !== false,
      watchDir: options.dir,
      dbPath: options.db,
      configPath: options.config,
      legacyRules: options.legacyRules
    });

    if (staleNotice) {
      console.log(staleNotice);
    }

    if (result.alreadyRunning) {
      console.log(`TokenPal daemon is already running (pid ${result.pid}).`);
      process.exit(0);
    }

    if (result.started) {
      console.log(`started (pid ${result.pid})`);
      process.exit(0);
    }

    console.error(`Failed to start TokenPal daemon: ${result.error}`);
    process.exit(1);
  });

program
  .command('stop')
  .description('Stop the running TokenPal daemon and any helper overlay processes')
  .action(async () => {
    const result = await daemonManager.stop();
    if (staleNotice) {
      console.log(staleNotice);
    }
    if (!result.wasRunning) {
      console.log('not running');
    } else {
      console.log(`TokenPal daemon stopped (pid ${result.pid}).`);
    }

    const remaining = result.remainingOverlayProcesses || [];
    if (remaining.length === 0) {
      console.log('Overlay processes: none remaining.');
    } else {
      console.log(`Overlay processes found: ${remaining.map((p) => `pid ${p.pid} (${p.command || 'unknown'})`).join(', ')}.`);
    }
    process.exit(0);
  });

program
  .command('test-alert')
  .description('Send a labeled TEST alert through the running daemon to verify the overlay opens')
  .action(async () => {
    const status = daemonManager.getStatus();
    if (!status.running || !status.pid) {
      console.log('TokenPal daemon is not running.');
      process.exit(0);
    }

    try {
      await daemonManager.sendControlCommand({ command: 'test-alert' });
      console.log(`Sent TEST alert to running TokenPal daemon (pid ${status.pid}). Overlay opening...`);
    } catch (err: any) {
      console.error(`Failed to send test alert to daemon: ${err?.message || err}`);
      process.exit(1);
    }
  });

program
  .command('restart')
  .description('Restart the TokenPal daemon')
  .option('-d, --dir <path>', 'Custom directory to watch for session logs')
  .option('--db <path>', 'Path to SQLite database', path.join(os.homedir(), '.tokenpal', 'tokenpal.sqlite'))
  .option('--config <path>', 'Path to custom config.json')
  .option('--ui', 'Launch desktop overlay mascot during alerts')
  .option('--no-ui', 'Disable desktop overlay mascot during alerts')
  .option('--legacy-rules', 'Enable retired context growth alerts (off by default)')
  .action(async (options) => {
    const stopped = await daemonManager.stop();
    if (stopped.wasRunning) {
      console.log(`TokenPal daemon stopped (pid ${stopped.pid}).`);
    }

    const started = await daemonManager.start({
      ui: options.ui !== false,
      watchDir: options.dir,
      dbPath: options.db,
      configPath: options.config,
      legacyRules: options.legacyRules
    });

    if (staleNotice) {
      console.log(staleNotice);
    }

    if (started.alreadyRunning) {
      console.log(`TokenPal daemon is already running (pid ${started.pid}).`);
      process.exit(0);
    }

    if (started.started) {
      console.log(`started (pid ${started.pid})`);
      process.exit(0);
    }

    console.error(`Failed to restart TokenPal daemon: ${started.error}`);
    process.exit(1);
  });

program
  .command('watch')
  .description('Watch agent sessions in foreground and display context size and alerts')
  .option('-d, --dir <path>', 'Custom directory to watch for session logs')
  .option('--db <path>', 'Path to SQLite database', path.join(os.homedir(), '.tokenpal', 'tokenpal.sqlite'))
  .option('--config <path>', 'Path to custom config.json')
  .option('--ui', 'Launch desktop overlay mascot during alerts')
  .option('--no-ui', 'Disable desktop overlay mascot during alerts')
  .option('--legacy-rules', 'Enable retired context growth alerts (off by default)')
  .option('--tokenpal-daemon', 'Internal marker indicating daemon process')
  .action(async (options) => {
    await runWatcherForeground(options);
  });

program
  .command('status')
  .description('Show TokenPal daemon state and current rate limit meter status')
  .option('-d, --dir <path>', 'Custom directory containing agent session logs (defaults to ~/.codex/sessions)')
  .option('--db <path>', 'Path to SQLite database', path.join(os.homedir(), '.tokenpal', 'tokenpal.sqlite'))
  .option('--json', 'Output machine-readable JSON')
  .action(async (options) => {
    const daemon = daemonManager.getStatus();

    let db: TokenPalDatabase | undefined;
    if (options.db) {
      const dbDir = path.dirname(options.db);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      db = new TokenPalDatabase(options.db);
    }

    const sessionsDir = options.dir ? path.resolve(options.dir) : undefined;
    const status = await readLatestMeterStatus({ sessionsDir, db });

    if (options.json) {
      console.log(JSON.stringify({ daemon, meter: status }, null, 2));
      if (db) db.close();
      return;
    }

    // First line shows running/stopped (pid, uptime)
    if (daemon.running) {
      console.log(`TokenPal daemon: running (pid ${daemon.pid}, uptime ${daemon.uptimeFormatted || '0s'})\n`);
    } else {
      console.log('TokenPal daemon: stopped\n');
    }

    if (staleNotice) {
      console.log(staleNotice + '\n');
    }

    if (!status) {
      console.log('No rate limit meter events found.');
      if (db) db.close();
      return;
    }

    const lastResetDisplay = status.lastReset
      ? `${status.lastReset.tsLocal} (from ${status.lastReset.prevUsedPercent ?? '?'}% to 0%, early: ${status.lastReset.isEarly ? 'yes' : 'no'})`
      : 'None recorded';

    const earlyResetDisplay = status.earlyResetsCount > 0
      ? `${status.earlyResetsCount} in the last 7 days`
      : '0';

    const staleIndicator = status.isStale
      ? ` (⚠️ STALE: ${status.staleReason || 'Reading is older than 30m or reset passed'})`
      : '';

    console.log('TokenPal Meter Status:');
    console.log(`  Quota Used       : ${status.percentBar}`);
    console.log(`  As of            : ${status.asOfLocal}${staleIndicator}`);
    console.log(`  Time to Reset    : ${status.timeToResetFormatted} (resets at ${status.resetsAtLocal})`);
    console.log(`  Plan Type        : ${status.planType}`);
    console.log(`  Last Reset       : ${lastResetDisplay}`);
    console.log(`  Early Resets     : ${earlyResetDisplay}`);
    if (status.projectedExhaustionText) {
      console.log(`  Projection       : ${status.projectedExhaustionText}`);
    }
    if (status.modelBadgeText) {
      console.log(`  Model Note       : ${status.modelBadgeText}`);
    }

    if (db) db.close();
  });

program
  .command('logs')
  .description('Print the latest TokenPal daemon logs (default: last 50 lines)')
  .option('-n, --lines <count>', 'Number of lines to display', '50')
  .option('-f, --follow', 'Follow log output in real time')
  .action((options) => {
    const linesCount = parseInt(options.lines, 10) || 50;
    const logInfo = daemonManager.getLogs(linesCount);

    if (!fs.existsSync(logInfo.logPath)) {
      console.log(`No log file found at ${logInfo.logPath}.`);
      process.exit(0);
    }

    for (const line of logInfo.lines) {
      console.log(line);
    }

    if (options.follow) {
      let currentSize = 0;
      try {
        currentSize = fs.statSync(logInfo.logPath).size;
      } catch {
        currentSize = 0;
      }

      const pollTimer = setInterval(() => {
        try {
          if (!fs.existsSync(logInfo.logPath)) return;
          const stats = fs.statSync(logInfo.logPath);
          if (stats.size > currentSize) {
            const fd = fs.openSync(logInfo.logPath, 'r');
            const buffer = Buffer.alloc(stats.size - currentSize);
            fs.readSync(fd, buffer, 0, buffer.length, currentSize);
            fs.closeSync(fd);
            currentSize = stats.size;
            process.stdout.write(buffer.toString('utf-8'));
          } else if (stats.size < currentSize) {
            // Log rotation occurred, reset offset
            currentSize = 0;
          }
        } catch {
          // ignore transient read errors
        }
      }, 250);

      process.on('SIGINT', () => {
        clearInterval(pollTimer);
        process.exit(0);
      });
    }
  });

program
  .command('autostart <action>')
  .description('Configure macOS launchd LaunchAgent to start TokenPal on login (on | off)')
  .action((action: string) => {
    const normalized = action.toLowerCase();
    if (normalized !== 'on' && normalized !== 'off') {
      console.error('Invalid action. Usage: tokenpal autostart on|off');
      process.exit(1);
    }

    if (normalized === 'on') {
      const res = enableAutostart();
      if (!res.supported) {
        console.log('not supported yet');
        process.exit(0);
      }
      if (!res.success) {
        console.error(`Error enabling autostart: ${res.error}`);
        process.exit(1);
      }
      console.log(res.message);
      console.log(`Command executed: ${res.commandExecuted}`);
    } else {
      const res = disableAutostart();
      if (!res.supported) {
        console.log('not supported yet');
        process.exit(0);
      }
      console.log(res.message);
      if (res.commandExecuted) {
        console.log(`Command executed: ${res.commandExecuted}`);
      }
    }
  });

program
  .command('demo')
  .description('Open desktop overlay once and cycle through mascot animations and customize window with fake data (~5s each) then exit')
  .action(async () => {
    const states = getAllDemoStates();
    const launcher = new OverlayLauncher();

    console.log('='.repeat(70));
    console.log(' TokenPal Overlay Demo Mode');
    console.log(' Cycling through 6 animations (idle, walk, speech notice, curious look-up,');
    console.log(' alert with auto-opened panel, sleep) and customize window (~5s each).');
    console.log(' Zero file reads. Press Ctrl+C at any time to exit.');
    console.log('='.repeat(70) + '\n');

    process.on('SIGINT', () => {
      console.log('\nExiting demo...');
      launcher.close();
      process.exit(0);
    });

    const totalSteps = states.length + 1;
    for (let i = 0; i < states.length; i++) {
      const step = states[i];
      console.log(`[${i + 1}/${totalSteps}] ${step.name.toUpperCase()}: ${step.description}`);
      launcher.showAlert(step.payload);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    console.log(`[${totalSteps}/${totalSteps}] CUSTOMIZE_WINDOW: DEMO: Customize Window (Skin picker, tint, accessories, size, roam)`);
    launcher.showAlert({
      state: 'green',
      reason: 'DEMO: Customize Window opened (Skins, color tints, accessories, size, opacity)',
      advice: 'Try customizing your mascot in real-time.',
      animationOverride: 'happy',
      openCustomize: true
    });
    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log('\nDemo complete. Closing overlay...');
    launcher.close();
    await new Promise((resolve) => setTimeout(resolve, 500));
    process.exit(0);
  });

program
  .command('replay <file>')
  .description('Replay a past session file and print turn-by-turn context size and rule alerts')
  .option('--config <path>', 'Path to custom config.json')
  .action(async (file, options) => {
    const fullPath = path.resolve(file);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: File not found: ${fullPath}`);
      process.exit(1);
    }

    const thresholds = loadRuleThresholds(options.config);
    console.log(`Replaying session: ${path.basename(fullPath)}`);
    const result = await replaySessionFile(fullPath, [new CodexAdapter()], thresholds);

    if (result.error) {
      console.error(`Error replaying session: ${result.error}`);
      process.exit(1);
    }

    if (result.session) {
      console.log(`Session ID : ${result.session.id}`);
      console.log(`Agent      : ${result.session.agent}`);
      console.log(`CLI Version: ${result.cliVersion || 'unknown'}`);
      console.log(`Project    : ${result.session.project_path || 'unknown'}`);
    }

    console.log('\nTurn-by-turn breakdown:');
    console.log('-'.repeat(95));
    console.log(
      'Turn'.padEnd(6) +
      'State'.padEnd(8) +
      'Model'.padEnd(16) +
      'Context (Input)'.padEnd(18) +
      'Cached Input'.padEnd(15) +
      'Output'.padEnd(10) +
      'Alert'
    );
    console.log('-'.repeat(95));

    for (const t of result.turns) {
      const alertSnippet = t.alert ? `[${t.alert.rule}] ${t.alert.reason}` : '';
      console.log(
        `#${t.turnIndex}`.padEnd(6) +
        `${t.state.toUpperCase()}`.padEnd(8) +
        `${(t.model || 'unknown').slice(0, 14)}`.padEnd(16) +
        `${t.inputTokens.toLocaleString()}`.padEnd(18) +
        `${t.cachedTokens.toLocaleString()}`.padEnd(15) +
        `${t.outputTokens.toLocaleString()}`.padEnd(10) +
        alertSnippet
      );
    }

    console.log('-'.repeat(95));
    console.log(`Total turns   : ${result.turns.length}`);
    console.log(`Max context   : ${result.maxContextSize.toLocaleString()} tokens`);
    console.log(`Total tokens  : ${result.totalTokens.toLocaleString()}`);
    console.log(`Tool events   : ${result.toolEvents.length}`);

    if (result.alerts.length > 0) {
      console.log('\n=== Triggered Alerts Summary ===');
      for (const a of result.alerts) {
        const icon = a.alert.severity === 'red' ? '🚨 RED ALERT' : '⚠️ HEAVY';
        console.log(`Turn #${a.turnIndex}: ${icon} [${a.alert.rule}] (Score: ${a.alert.score})`);
        console.log(`  Reason : ${a.alert.reason}`);
        console.log(`  Advice : ${a.alert.advice}`);
      }
    } else {
      console.log('\nNo alerts fired during this session (healthy thread).');
    }
  });

program
  .command('handoff')
  .description('Generate a Layer A context handoff summary from git state and session facts')
  .option('-p, --project <dir>', 'Project root directory', process.cwd())
  .option('-s, --session <id>', 'Specific session ID to summarize')
  .option('--db <path>', 'Path to SQLite database', path.join(os.homedir(), '.tokenpal', 'tokenpal.sqlite'))
  .action(async (options) => {
    const projectPath = path.resolve(options.project);
    let session;
    let db: TokenPalDatabase | undefined;

    if (fs.existsSync(options.db)) {
      db = new TokenPalDatabase(options.db);
      if (options.session) {
        session = db.getSession(options.session);
      } else {
        const recent = db.getRecentSessions(1);
        if (recent.length > 0) session = recent[0];
      }
    }

    console.log(`Generating handoff for: ${projectPath}`);
    const result = await generateLayerAHandoff({
      projectPath,
      session,
      db
    });

    console.log(`✓ Handoff generated (${result.lineCount} lines, target < 60)`);
    console.log(`✓ Saved to: ${result.filePath}`);

    if (result.copiedToClipboard) {
      console.log('✓ Copied to clipboard automatically');
    } else {
      console.log('ℹ Clipboard copy unavailable (saved to file only)');
    }

    if (!result.gitignored) {
      console.warn('\n⚠️  WARNING: .handoff is not found in your .gitignore!');
      console.warn('   Add ".handoff/" to .gitignore to avoid committing handoffs to git.\n');
    }

    console.log('\n' + '='.repeat(60));
    console.log(result.markdown);
    console.log('='.repeat(60));
  });

program.parse(process.argv);
