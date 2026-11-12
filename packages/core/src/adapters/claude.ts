import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentAdapter } from './interface.js';
import { ParseResult, Session, Turn, ToolEvent, MeterReading, TaskLifecycleEvent } from '../types.js';

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude';
  readonly name = 'Claude Code';

  canHandle(filePath: string): boolean {
    const base = path.basename(filePath);
    if (!base.endsWith('.jsonl')) return false;
    if (base === 'history.jsonl') return false;

    // Checks path or filename for Claude indicators
    const normalized = filePath.replace(/\\/g, '/');
    const isClaudePath = normalized.includes('/.claude/projects/') ||
      normalized.includes('/.claude/sessions/') ||
      normalized.includes('/.claude/') ||
      base.includes('claude');

    // Matches standard UUID session naming e.g. 26d0bef8-3cd3-474d-9011-d099134468f2.jsonl
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i.test(base);

    return isClaudePath || isUuid;
  }

  getDefaultWatchDirs(): string[] {
    const dirs: string[] = [];
    const claudeProjects = path.join(os.homedir(), '.claude', 'projects');
    if (fs.existsSync(claudeProjects)) {
      dirs.push(claudeProjects);
    }
    const claudeSessions = path.join(os.homedir(), '.claude', 'sessions');
    if (fs.existsSync(claudeSessions)) {
      dirs.push(claudeSessions);
    }
    return dirs;
  }

  async parseIncremental(filePath: string, startOffset = 0): Promise<ParseResult> {
    if (!fs.existsSync(filePath)) {
      return { turns: [], toolEvents: [], newOffset: startOffset, error: 'File does not exist' };
    }

    let stats: fs.Stats;
    try {
      stats = fs.statSync(filePath);
    } catch {
      return { turns: [], toolEvents: [], newOffset: startOffset, error: 'Failed to stat file' };
    }

    const fileSize = stats.size;
    if (fileSize <= startOffset) {
      return { turns: [], toolEvents: [], newOffset: startOffset };
    }

    const bytesToRead = fileSize - startOffset;
    const buffer = Buffer.alloc(bytesToRead);

    let fd: number;
    try {
      fd = fs.openSync(filePath, 'r');
    } catch {
      return { turns: [], toolEvents: [], newOffset: startOffset, error: 'Failed to open file' };
    }

    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, startOffset);
    } finally {
      fs.closeSync(fd);
    }

    if (bytesRead <= 0) {
      return { turns: [], toolEvents: [], newOffset: startOffset };
    }

    // Find the last newline to prevent processing truncated partial lines
    const lastNewlineIndex = buffer.lastIndexOf(0x0a); // '\n'
    if (lastNewlineIndex === -1) {
      // Incomplete line, await more bytes
      return { turns: [], toolEvents: [], newOffset: startOffset };
    }

    const validChunkBuffer = buffer.subarray(0, lastNewlineIndex + 1);
    const content = validChunkBuffer.toString('utf-8');
    const newOffset = startOffset + lastNewlineIndex + 1;

    const lines = content.split('\n');
    const turns: Turn[] = [];
    const toolEvents: ToolEvent[] = [];
    const meterReadings: MeterReading[] = [];
    const taskEvents: TaskLifecycleEvent[] = [];
    let sessionData: Partial<Session> | undefined;
    let cliVersion: string | undefined;

    let activeModel: string | null = null;
    let currentSessionId: string | null = null;
    let projectPath: string | null = null;
    let startedAt: string | null = null;
    let lastEventAt: string | null = null;
    const pendingToolCalls = new Map<string, { name: string; callId: string; ts: string }>();
    let accumulatedToolBytesInTurn = 0;
    let userMessagesCount = 0;
    let modelCallsCount = 0;
    let compactionsCount = 0;

    let validJsonCount = 0;
    let parseErrorCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event: any;
      try {
        event = JSON.parse(trimmed);
        validJsonCount++;
      } catch {
        parseErrorCount++;
        continue;
      }

      const ts = event.timestamp || new Date().toISOString();
      lastEventAt = ts;

      // Extract session ID and project path whenever present
      if (event.sessionId || event.session_id) {
        currentSessionId = event.sessionId || event.session_id || currentSessionId;
      }
      if (event.cwd) {
        projectPath = event.cwd || projectPath;
      }
      if (event.version) {
        cliVersion = event.version || cliVersion;
      }

      const eventType = event.type;

      // 1. Model / Environment Attachments
      if (eventType === 'attachment') {
        const attachment = event.attachment || {};
        if (attachment.type === 'model' && attachment.identity?.modelId) {
          activeModel = attachment.identity.modelId;
        } else if (attachment.type === 'environment' && attachment.snapshot?.workingDirectory) {
          projectPath = attachment.snapshot.workingDirectory;
        }
      }

      // 2. User Message & Tool Results
      if (eventType === 'user') {
        userMessagesCount++;
        if (!startedAt) {
          startedAt = ts;
        }

        taskEvents.push({
          type: 'task_started',
          turnId: event.uuid,
          sessionId: currentSessionId || undefined,
          ts
        });

        // Scan for tool_result content blocks
        const messageContent = event.message?.content;
        if (Array.isArray(messageContent)) {
          for (const item of messageContent) {
            if (item && item.type === 'tool_result') {
              const callId = item.tool_use_id;
              const callInfo = callId ? pendingToolCalls.get(callId) : undefined;
              const toolName = callInfo?.name || 'unknown';

              let outputBytes = 0;
              let contentText = '';
              if (typeof item.content === 'string') {
                outputBytes = Buffer.byteLength(item.content, 'utf-8');
                contentText = item.content;
              } else if (Array.isArray(item.content)) {
                for (const sub of item.content) {
                  if (typeof sub?.text === 'string') {
                    outputBytes += Buffer.byteLength(sub.text, 'utf-8');
                    contentText += sub.text + ' ';
                  }
                }
              }

              accumulatedToolBytesInTurn += outputBytes;

              // Parse exit code from text or error flag
              let exitCode: number | null = null;
              const exitMatch = contentText.match(/(?:exit code:?|exited with code|Process exited)\s*(\d+)/i);
              if (exitMatch && exitMatch[1]) {
                exitCode = parseInt(exitMatch[1], 10);
              } else if (item.is_error === true) {
                exitCode = 1;
              } else if (item.is_error === false) {
                exitCode = 0;
              }

              toolEvents.push({
                id: item.tool_use_id || `tool-${Date.now()}-${toolEvents.length}`,
                session_id: currentSessionId || 'unknown',
                ts,
                name: toolName,
                exit_code: exitCode,
                output_bytes: outputBytes,
                command_hash: null
              });

              if (callId) {
                pendingToolCalls.delete(callId);
              }
            }
          }
        }
      }

      // 3. Assistant Message & Usage
      if (eventType === 'assistant') {
        modelCallsCount++;

        const msg = event.message || {};
        if (msg.model && msg.model !== '<synthetic>') {
          activeModel = msg.model;
        }

        const usage = msg.usage || {};
        const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
        const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
        const cachedTokens = (typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0) +
          (typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0);
        const reasoningTokens = typeof usage.output_tokens_details?.reasoning_tokens === 'number'
          ? usage.output_tokens_details.reasoning_tokens
          : 0;

        // Collect any tool calls
        if (Array.isArray(msg.content)) {
          for (const item of msg.content) {
            if (item && item.type === 'tool_use') {
              const callId = item.id;
              const name = item.name || 'unknown';
              if (callId) {
                pendingToolCalls.set(callId, { name, callId, ts });
              }
            }
          }
        }

        const turn: Turn = {
          id: event.uuid || msg.id || `turn-${Date.now()}-${turns.length}`,
          session_id: currentSessionId || 'unknown',
          ts,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cached_tokens: cachedTokens,
          reasoning_tokens: reasoningTokens,
          model: activeModel,
          effort: null,
          tool_output_bytes: accumulatedToolBytesInTurn,
          user_message_index: userMessagesCount,
          call_index: modelCallsCount
        };

        turns.push(turn);
        accumulatedToolBytesInTurn = 0;

        // Check if turn finished without tool calls (task complete)
        if (msg.stop_reason === 'end_turn' || (msg.stop_reason === 'stop_sequence' && pendingToolCalls.size === 0)) {
          taskEvents.push({
            type: 'task_complete',
            turnId: turn.id,
            sessionId: currentSessionId || undefined,
            ts
          });
        }
      }

      // 4. Compactions
      if (eventType === 'compacted' || eventType === 'context-compaction') {
        compactionsCount++;
      }

      // 5. Cost State / Rate Limits (if logged)
      if (eventType === 'cost-state' || eventType === 'rate_limit') {
        const rl = event.rate_limits || event.rateLimits;
        if (rl && typeof rl.used_percent === 'number' && typeof rl.resets_at === 'number' && typeof rl.window_minutes === 'number') {
          meterReadings.push({
            sessionId: currentSessionId || undefined,
            ts,
            usedPercent: rl.used_percent,
            windowMinutes: rl.window_minutes,
            resetsAt: rl.resets_at,
            planType: rl.plan_type || undefined
          });
        }
      }
    }

    // Fail-safe: if lines were read but not a single valid JSON object was parsed
    if (lines.length > 0 && validJsonCount === 0 && parseErrorCount > 0) {
      return { turns: [], toolEvents: [], newOffset: startOffset, error: 'unsupported version' };
    }

    if (currentSessionId) {
      sessionData = {
        id: currentSessionId,
        agent: 'claude',
        project_path: projectPath,
        started_at: startedAt || lastEventAt || new Date().toISOString(),
        last_event_at: lastEventAt || new Date().toISOString(),
        model: activeModel,
        status: 'active'
      };
    }

    return {
      session: sessionData,
      turns,
      toolEvents,
      newOffset,
      cliVersion,
      userMessagesCount,
      modelCallsCount,
      compactionsCount,
      meterReadings,
      taskEvents
    };
  }
}
