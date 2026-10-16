#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { TokenPalDatabase, SessionWatcher, replaySessionFile, CodexAdapter } from '@tokenpal/core';

const program = new Command();

program
  .name('tokenpal')
  .description('Proactive Context and Token Guardian for AI Coding Agents')
  .version('0.1.0');

program
  .command('watch')
  .description('Watch agent sessions and display context size and token metrics per turn')
  .option('-d, --dir <path>', 'Custom directory to watch for session logs')
  .option('--db <path>', 'Path to SQLite database', path.join(os.homedir(), '.tokenpal', 'tokenpal.sqlite'))
  .option('--no-ui', 'Run in terminal-only mode without desktop overlay', true)
  .action(async (options) => {
    // Ensure db directory exists
    const dbDir = path.dirname(options.db);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const db = new TokenPalDatabase(options.db);
    const customDirs = options.dir ? [path.resolve(options.dir)] : [];
    const watcher = new SessionWatcher({ db, customDirs, pollIntervalMs: 1000 });

    console.log('='.repeat(70));
    console.log(' TokenPal Watcher started (M1 Watch Mode)');
    console.log(` Watching directories: ${watcher.getWatchDirs().join(', ')}`);
    console.log(` Database: ${options.db}`);
    console.log('='.repeat(70));
    console.log('Listening for session turns in real time...\n');

    watcher.on('turn', (payload) => {
      const { session, turn, turnIndex } = payload;
      const shortId = session.id.slice(0, 8);
      const model = turn.model || 'unknown';
      const effort = turn.effort ? ` [${turn.effort}]` : '';
      const contextSize = turn.input_tokens.toLocaleString();
      const outputTok = turn.output_tokens.toLocaleString();
      const cachedTok = turn.cached_tokens.toLocaleString();

      const timeStr = new Date(turn.ts).toLocaleTimeString();
      console.log(
        `[${timeStr}] Session ${shortId} | Turn #${turnIndex.toString().padStart(2)} | ` +
        `Model: ${model}${effort} | ` +
        `Context: ${contextSize.padStart(7)} tokens | ` +
        `Cached: ${cachedTok.padStart(6)} | ` +
        `Output: ${outputTok.padStart(5)}`
      );
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
  .description('Replay a past session file and print turn-by-turn context size and token metrics')
  .action(async (file) => {
    const fullPath = path.resolve(file);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: File not found: ${fullPath}`);
      process.exit(1);
    }

    console.log(`Replaying session: ${path.basename(fullPath)}`);
    const result = await replaySessionFile(fullPath, [new CodexAdapter()]);

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
    console.log('-'.repeat(85));
    console.log(
      'Turn'.padEnd(6) +
      'Model'.padEnd(16) +
      'Context (Input)'.padEnd(18) +
      'Cached Input'.padEnd(16) +
      'Output'.padEnd(12) +
      'Cumul. Total'
    );
    console.log('-'.repeat(85));

    for (const t of result.turns) {
      console.log(
        `#${t.turnIndex}`.padEnd(6) +
        `${(t.model || 'unknown').slice(0, 14)}`.padEnd(16) +
        `${t.inputTokens.toLocaleString()}`.padEnd(18) +
        `${t.cachedTokens.toLocaleString()}`.padEnd(16) +
        `${t.outputTokens.toLocaleString()}`.padEnd(12) +
        `${t.cumulativeTotalTokens.toLocaleString()}`
      );
    }

    console.log('-'.repeat(85));
    console.log(`Total turns   : ${result.turns.length}`);
    console.log(`Max context   : ${result.maxContextSize.toLocaleString()} tokens`);
    console.log(`Total tokens  : ${result.totalTokens.toLocaleString()}`);
    console.log(`Tool events   : ${result.toolEvents.length}`);
  });

program.parse(process.argv);
