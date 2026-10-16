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
  generateLayerAHandoff
} from '@tokenpal/core';


const program = new Command();

program
  .name('tokenpal')
  .description('Proactive Context and Token Guardian for AI Coding Agents')
  .version('0.1.0');

program
  .command('watch')
  .description('Watch agent sessions and display context size, token metrics, and proactive alerts')
  .option('-d, --dir <path>', 'Custom directory to watch for session logs')
  .option('--db <path>', 'Path to SQLite database', path.join(os.homedir(), '.tokenpal', 'tokenpal.sqlite'))
  .option('--config <path>', 'Path to custom config.json')
  .option('--no-ui', 'Run in terminal-only mode without desktop overlay', true)
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

    console.log('='.repeat(75));
    console.log(' TokenPal Guardian Watcher started (M2 Rules Engine Active)');
    console.log(` Watching directories : ${watcher.getWatchDirs().join(', ')}`);
    console.log(` Database             : ${options.db}`);
    console.log(` Context Growth Limit : ${thresholds.contextGrowthMultiplier}x / ${thresholds.contextMaxTokens.toLocaleString()} tokens`);
    console.log(` Turn Count Limit     : ${thresholds.turnCountMax} turns`);
    console.log('='.repeat(75));
    console.log('Listening for session turns in real time...\n');

    watcher.on('turn', (payload) => {
      const { session, turn, turnIndex } = payload;
      const turns = db.getTurns(session.id);
      const tools = db.getToolEvents(session.id);

      const evalResult = engine.evaluate(session, turns, tools, true);

      const shortId = session.id.slice(0, 8);
      const model = turn.model || 'unknown';
      const effort = turn.effort ? ` [${turn.effort}]` : '';
      const contextSize = turn.input_tokens.toLocaleString();
      const outputTok = turn.output_tokens.toLocaleString();
      const cachedTok = turn.cached_tokens.toLocaleString();

      const timeStr = new Date(turn.ts).toLocaleTimeString();
      const stateBadge = evalResult.state.toUpperCase().padEnd(6);

      console.log(
        `[${timeStr}] [${stateBadge}] Sess ${shortId} | Turn #${turnIndex.toString().padStart(2)} | ` +
        `Model: ${model}${effort} | ` +
        `Context: ${contextSize.padStart(7)} | ` +
        `Cached: ${cachedTok.padStart(6)} | ` +
        `Out: ${outputTok.padStart(5)}`
      );

      if (evalResult.shouldAlert && evalResult.primaryAlert) {
        const alert = evalResult.primaryAlert;
        const icon = alert.severity === 'red' ? '🚨 RED ALERT' : '⚠️ HEAVY THREAD';
        console.log(`\n  ${icon} [${alert.rule}]`);
        console.log(`  Reason : ${alert.reason}`);
        console.log(`  Action : ${alert.advice}\n`);

        db.insertAlert({
          id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          session_id: session.id,
          ts: turn.ts,
          rule: alert.rule,
          severity: alert.severity,
          shown: 1,
          action_taken: null
        });
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

program.parse(process.argv);

