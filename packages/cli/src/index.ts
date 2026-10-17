#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
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
  readLatestMeterStatus,
  getDemoStates
} from '@tokenpal/core';


const program = new Command();

program
  .name('tokenpal')
  .description('Proactive Context and Token Guardian for AI Coding Agents')
  .version('0.1.0');

program
  .command('watch')
  .description('Watch agent sessions and display context size, token metrics, rate limits meter, and proactive alerts')
  .option('-d, --dir <path>', 'Custom directory to watch for session logs')
  .option('--db <path>', 'Path to SQLite database', path.join(os.homedir(), '.tokenpal', 'tokenpal.sqlite'))
  .option('--config <path>', 'Path to custom config.json')
  .option('--ui', 'Launch desktop overlay mascot (defaults to terminal-only if omitted)')
  .option('--legacy-rules', 'Enable retired context growth alerts (off by default)')
  .action(async (options) => {
    // Ensure db directory exists
    const dbDir = path.dirname(options.db);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const thresholds = loadRuleThresholds(options.config);
    const engine = new RulesEngine(thresholds);
    const db = new TokenPalDatabase(options.db);
    const customDirs = options.dir ? [path.resolve(options.dir)] : [];
    const watcher = new SessionWatcher({ db, customDirs, pollIntervalMs: 1000 });
    const alertManager = new MeterAlertManager();
    const launcher = options.ui ? new OverlayLauncher() : null;

    console.log('='.repeat(75));
    console.log(' TokenPal Guardian Watcher started (Rate Limit Meter Redesign Active)');
    console.log(` Watching directories : ${watcher.getWatchDirs().join(', ')}`);
    console.log(` Database             : ${options.db}`);
    console.log(' Active Alerts        : Projected exhaustion before reset | Single request > 3%');
    console.log(' Cooldown             : Once per hour per alert type');
    console.log('='.repeat(75));

    // Show initial meter snapshot if present in database
    const initialSnapshot = db.getLatestMeterSnapshot();
    if (initialSnapshot) {
      const initialStatus = watcher.getMeterReader().getMeterStatus();
      if (initialStatus) {
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

        db.insertAlert({
          id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          session_id: 'meter',
          ts: new Date().toISOString(),
          rule: alert.rule || 'projected_exhaustion',
          severity: alert.state,
          shown: 1,
          action_taken: null
        });

        if (launcher) {
          launcher.showAlert(alert);
        }
      }
    });

    // Model switch notification (one-time notice, no yellow state)
    watcher.on('model_switch', ({ notice }) => {
      console.log(`\n[NOTICE] ${notice}\n`);
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

          db.insertAlert({
            id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            session_id: 'meter',
            ts: new Date().toISOString(),
            rule: alert.rule || 'single_request_high',
            severity: alert.state,
            shown: 1,
            action_taken: null
          });

          if (launcher) {
            launcher.showAlert(alert);
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

      // Legacy rules check if explicitly enabled
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

    // Graceful exit
    process.on('SIGINT', () => {
      console.log('\nStopping TokenPal watcher...');
      watcher.stop();
      if (launcher) {
        launcher.close();
      }
      db.close();
      process.exit(0);
    });
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

program
  .command('status')
  .description('Print current rate limit meter status once (percent, countdown, plan, resets) read from latest session event')
  .option('-d, --dir <path>', 'Custom directory containing agent session logs (defaults to ~/.codex/sessions)')
  .option('--db <path>', 'Path to SQLite database', path.join(os.homedir(), '.tokenpal', 'tokenpal.sqlite'))
  .option('--json', 'Output machine-readable JSON')
  .action(async (options) => {
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

    if (!status) {
      console.log('No rate limit meter events found.');
      if (db) db.close();
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
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
  .command('demo')
  .description('Open desktop overlay once and cycle through all 5 guardian states with fake data (~5s each) then exit')
  .action(async () => {
    const states = getDemoStates();
    const launcher = new OverlayLauncher();

    console.log('='.repeat(70));
    console.log(' TokenPal Overlay Demo Mode');
    console.log(' Cycling through 5 guardian states (~5s each) using fake data.');
    console.log(' Zero file reads. Press Ctrl+C at any time to exit.');
    console.log('='.repeat(70) + '\n');

    process.on('SIGINT', () => {
      console.log('\nExiting demo...');
      launcher.close();
      process.exit(0);
    });

    for (let i = 0; i < states.length; i++) {
      const step = states[i];
      console.log(`[${i + 1}/${states.length}] ${step.name.toUpperCase()}: ${step.description}`);
      launcher.showAlert(step.payload);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    console.log('\nDemo complete. Closing overlay...');
    launcher.close();
    await new Promise((resolve) => setTimeout(resolve, 500));
    process.exit(0);
  });

program.parse(process.argv);

