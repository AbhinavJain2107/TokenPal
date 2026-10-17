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

  // If already registered, safely unload before rewriting
  if (fs.existsSync(plistPath)) {
    try {
      child_process.execSync(`launchctl unload -w ${plistPath}`, { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      // ignore
    }
  }

  const plistContent = generateLaunchAgentPlist({
    nodePath,
    cliPath,
    logPath,
    label
  });

  fs.writeFileSync(plistPath, plistContent, 'utf-8');

  // Load via launchctl
  const command = `launchctl load -w ${plistPath}`;
  try {
    child_process.execSync(command, { stdio: ['ignore', 'pipe', 'pipe'] });
    return {
      success: true,
      supported: true,
      plistPath,
      commandExecuted: command,
      message: `Autostart enabled via LaunchAgent: ${plistPath}`
    };
  } catch (err: any) {
    return {
      success: false,
      supported: true,
      plistPath,
      commandExecuted: command,
      error: `Failed to execute launchctl: ${err.message}`
    };
  }
}

/**
 * Disables autostart by unloading the launchd LaunchAgent and removing the plist.
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

  let commandExecuted: string | undefined;
  if (fs.existsSync(plistPath)) {
    const command = `launchctl unload -w ${plistPath}`;
    commandExecuted = command;
    try {
      child_process.execSync(command, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      // ignore if already unloaded
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
