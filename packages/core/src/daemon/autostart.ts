import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as child_process from 'node:child_process';

import { resolveDefaultCliPath } from './manager.js';

export const LAUNCH_AGENT_LABEL = 'com.tokenpal.watcher';

export interface AutostartOptions {
  nodePath?: string;
  cliPath?: string;
  logPath?: string;
  plistDir?: string;
  label?: string;
}

export interface AutostartResult {
  success: boolean;
  supported: boolean;
  plistPath?: string;
  commandExecuted?: string;
  error?: string;
  message?: string;
}

/**
 * Generates the macOS launchd LaunchAgent XML plist with RunAtLoad=true and NO KeepAlive.
 * Using absolute paths to node and the CLI so stop stays stopped.
 */
export function generateLaunchAgentPlist(options: {
  nodePath: string;
  cliPath: string;
  logPath: string;
  label?: string;
}): string {
  const label = options.label || LAUNCH_AGENT_LABEL;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${options.nodePath}</string>
        <string>${options.cliPath}</string>
        <string>start</string>
        <string>--foreground</string>
        <string>--tokenpal-daemon</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${options.logPath}</string>
    <key>StandardErrorPath</key>
    <string>${options.logPath}</string>
</dict>
</plist>
`;
}

/**
 * Enables autostart via macOS launchd LaunchAgent.
 * Prefers modern `launchctl bootstrap gui/$(id -u)` with `launchctl load -w` as fallback.
 */
export function enableAutostart(options: AutostartOptions = {}): AutostartResult {
  if (process.platform !== 'darwin') {
    return {
      success: false,
      supported: false,
      message: 'not supported yet'
    };
  }

  const nodePath = options.nodePath || process.execPath;
  const cliPath = options.cliPath || resolveDefaultCliPath();
  const logPath = options.logPath || path.join(os.homedir(), '.tokenpal', 'tokenpal.log');
  const plistDir = options.plistDir || path.join(os.homedir(), 'Library', 'LaunchAgents');
  const label = options.label || LAUNCH_AGENT_LABEL;
  const plistPath = path.join(plistDir, `${label}.plist`);

  if (!fs.existsSync(plistDir)) {
    fs.mkdirSync(plistDir, { recursive: true });
  }

  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  const domainTarget = `gui/${uid}`;

  // If already registered, safely bootout/unload before rewriting
  if (fs.existsSync(plistPath)) {
    try {
      child_process.execSync(`launchctl bootout ${domainTarget} ${plistPath}`, { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      try {
        child_process.execSync(`launchctl unload -w ${plistPath}`, { stdio: ['ignore', 'ignore', 'ignore'] });
      } catch {
        // ignore
      }
    }
  }

  const plistContent = generateLaunchAgentPlist({
    nodePath,
    cliPath,
    logPath,
    label
  });

  fs.writeFileSync(plistPath, plistContent, 'utf-8');

  // Prefer modern launchctl bootstrap gui/$(id -u), fallback to legacy load -w
  const modernCommand = `launchctl bootstrap ${domainTarget} ${plistPath}`;
  const fallbackCommand = `launchctl load -w ${plistPath}`;
  let commandExecuted = modernCommand;

  try {
    child_process.execSync(modernCommand, { stdio: ['ignore', 'pipe', 'pipe'] });
    return {
      success: true,
      supported: true,
      plistPath,
      commandExecuted: modernCommand,
      message: `Autostart enabled via LaunchAgent: ${plistPath}`
    };
  } catch {
    commandExecuted = fallbackCommand;
    try {
      child_process.execSync(fallbackCommand, { stdio: ['ignore', 'pipe', 'pipe'] });
      return {
        success: true,
        supported: true,
        plistPath,
        commandExecuted: fallbackCommand,
        message: `Autostart enabled via LaunchAgent (fallback): ${plistPath}`
      };
    } catch (err: any) {
      return {
        success: false,
        supported: true,
        plistPath,
        commandExecuted,
        error: `Failed to execute launchctl: ${err.message}`
      };
    }
  }
}

/**
 * Disables autostart by unloading the launchd LaunchAgent and removing the plist.
 * Prefers modern `launchctl bootout gui/$(id -u)` with `launchctl unload -w` as fallback.
 */
export function disableAutostart(options: AutostartOptions = {}): AutostartResult {
  if (process.platform !== 'darwin') {
    return {
      success: false,
      supported: false,
      message: 'not supported yet'
    };
  }

  const plistDir = options.plistDir || path.join(os.homedir(), 'Library', 'LaunchAgents');
  const label = options.label || LAUNCH_AGENT_LABEL;
  const plistPath = path.join(plistDir, `${label}.plist`);
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  const domainTarget = `gui/${uid}`;

  let commandExecuted: string | undefined;
  if (fs.existsSync(plistPath)) {
    const modernCommand = `launchctl bootout ${domainTarget} ${plistPath}`;
    const fallbackCommand = `launchctl unload -w ${plistPath}`;
    commandExecuted = modernCommand;

    try {
      child_process.execSync(modernCommand, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      try {
        child_process.execSync(fallbackCommand, { stdio: ['ignore', 'pipe', 'pipe'] });
        commandExecuted = fallbackCommand;
      } catch {
        // ignore if already unloaded
      }
    }

    try {
      fs.unlinkSync(plistPath);
    } catch {
      // ignore
    }
  }

  return {
    success: true,
    supported: true,
    plistPath,
    commandExecuted,
    message: 'Autostart disabled (removed LaunchAgent).'
  };
}
