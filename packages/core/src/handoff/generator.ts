import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TokenPalDatabase } from '../db/database.js';
import { Session } from '../types.js';


export interface HandoffOptions {
  projectPath?: string;
  session?: Session;
  db?: TokenPalDatabase;
  firstUserMessage?: string;
  latestUserMessage?: string;
  sessionLogPath?: string;
}

export interface HandoffResult {
  markdown: string;
  lineCount: number;
  filePath: string;
  gitignored: boolean;
  copiedToClipboard: boolean;
}

function runGit(cmd: string, cwd: string): string {
  try {
    return child_process.execSync(cmd, { cwd, stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

export function isHandoffGitignored(projectPath: string): boolean {
  const gitignorePath = path.join(projectPath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return false;
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    return /^\s*\.handoff\/?\s*$/m.test(content) || /^\s*\*\.handoff\s*$/m.test(content);
  } catch {
    return false;
  }
}

export function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'darwin') {
      const proc = child_process.spawnSync('pbcopy', { input: text, encoding: 'utf-8' });
      return proc.status === 0;
    } else if (process.platform === 'win32') {
      const proc = child_process.spawnSync('clip', { input: text, encoding: 'utf-8' });
      return proc.status === 0;
    } else {
      // Linux: try xclip then xsel
      const xclip = child_process.spawnSync('xclip', ['-selection', 'clipboard'], { input: text, encoding: 'utf-8' });
      if (xclip.status === 0) return true;
      const xsel = child_process.spawnSync('xsel', ['--clipboard', '--input'], { input: text, encoding: 'utf-8' });
      return xsel.status === 0;
    }
  } catch {
    return false;
  }
}

export function extractUserMessagesFromLog(filePath: string): { first: string | null; latest: string | null } {
  if (!fs.existsSync(filePath)) return { first: null, latest: null };
  const userMessages: string[] = [];

  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'response_item' && obj.payload?.role === 'user') {
          const contents = obj.payload.content || [];
          for (const c of contents) {
            if (c.type === 'input_text' && typeof c.text === 'string' && c.text.trim()) {
              userMessages.push(c.text.trim());
            }
          }
        }
      } catch {
        // tolerate parsing glitches
      }
    }
  } catch {
    return { first: null, latest: null };
  }

  return {
    first: userMessages.length > 0 ? userMessages[0] : null,
    latest: userMessages.length > 1 ? userMessages[userMessages.length - 1] : (userMessages[0] || null)
  };
}

export async function generateLayerAHandoff(options: HandoffOptions = {}): Promise<HandoffResult> {
  const projectPath = options.projectPath || process.cwd();

  // 1. Git Facts
  const branch = runGit('git rev-parse --abbrev-ref HEAD', projectPath) || 'unknown';
  const lastCommit = runGit('git log -1 --oneline', projectPath) || 'none';
  const gitStatus = runGit('git status --short', projectPath);
  const gitDiffStat = runGit('git diff --stat', projectPath) || (gitStatus ? 'Unstaged changes in working tree' : 'Clean working directory');

  // 2. Recent Checks / Tool Events
  let lastChecks = 'None recorded in session';
  if (options.db && options.session) {
    const toolEvents = options.db.getToolEvents(options.session.id);
    const testOrLintEvents = toolEvents.filter(t =>
      /test|lint|typecheck|check/i.test(t.name) || (typeof t.exit_code === 'number')
    );
    if (testOrLintEvents.length > 0) {
      const recent = testOrLintEvents.slice(-3);
      lastChecks = recent.map(r => `${r.name}: ${r.exit_code === 0 ? 'Passed (exit 0)' : `Failed (exit ${r.exit_code})`}`).join(' | ');
    }
  }

  // 3. User Messages (Goal & Last Action)
  let goal = options.firstUserMessage;
  let latestTask = options.latestUserMessage;

  if (!goal && options.sessionLogPath) {
    const extracted = extractUserMessagesFromLog(options.sessionLogPath);
    goal = extracted.first || undefined;
    latestTask = extracted.latest || undefined;
  }

  const taskGoal = goal ? (goal.length > 140 ? goal.slice(0, 137) + '...' : goal) : 'Continue active milestone task';
  const currentStatus = latestTask ? (latestTask.length > 140 ? latestTask.slice(0, 137) + '...' : latestTask) : 'Working on codebase updates';

  // 4. Format template according to PRD lines 90-102
  const lines: string[] = [
    `# Handoff: ${path.basename(projectPath)}`,
    `Branch / last commit: ${branch} (${lastCommit})`,
    `Goal: ${taskGoal}`,
    `Done so far: ${currentStatus}`,
    `Files changed:`,
    '```',
    gitDiffStat.split('\n').slice(0, 12).join('\n'),
    '```',
    `Last checks: ${lastChecks}`,
    `Decisions and ruled-out approaches: See git history and commit notes.`,
    `Open problems: None reported blocking.`,
    `Next steps: Resume from handoff state.`,
    `Note: verify state with git diff before continuing.`
  ];

  const markdown = lines.join('\n');
  const lineCount = lines.length;

  // 5. Write to .handoff/latest.md
  const handoffDir = path.join(projectPath, '.handoff');
  if (!fs.existsSync(handoffDir)) {
    fs.mkdirSync(handoffDir, { recursive: true });
  }

  const handoffFilePath = path.join(handoffDir, 'latest.md');
  fs.writeFileSync(handoffFilePath, markdown, 'utf-8');

  // Check gitignore
  const gitignored = isHandoffGitignored(projectPath);

  // Copy to clipboard
  const copiedToClipboard = copyToClipboard(markdown);

  return {
    markdown,
    lineCount,
    filePath: handoffFilePath,
    gitignored,
    copiedToClipboard
  };
}
