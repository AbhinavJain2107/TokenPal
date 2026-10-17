import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentAdapter } from './interface.js';
import { ParseResult, Session, Turn, ToolEvent } from '../types.js';

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly name = 'Codex';

  canHandle(filePath: string): boolean {
    const base = path.basename(filePath);
    return (base.startsWith('rollout-') || base.includes('codex') || filePath.includes('.codex')) && base.endsWith('.jsonl');
  }


  getDefaultWatchDirs(): string[] {
    const codexSessions = path.join(os.homedir(), '.codex', 'sessions');
    return fs.existsSync(codexSessions) ? [codexSessions] : [];
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
      // No complete line read yet, wait for more bytes
      return { turns: [], toolEvents: [], newOffset: startOffset };
    }

    const validChunkBuffer = buffer.subarray(0, lastNewlineIndex + 1);
    const content = validChunkBuffer.toString('utf-8');
    const newOffset = startOffset + lastNewlineIndex + 1;

    const lines = content.split('\n');
    const turns: Turn[] = [];
    const toolEvents: ToolEvent[] = [];
    let sessionData: Partial<Session> | undefined;
    let cliVersion: string | undefined;

    // Track state within session
    let activeModel: string | null = null;
    let activeEffort: string | null = null;
    let currentSessionId: string | null = null;
    let projectPath: string | null = null;
    let startedAt: string | null = null;
    let lastEventAt: string | null = null;
    let pendingToolCalls = new Map<string, { name: string; callId: string; ts: string }>();
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

      const eventType = event.type;
      const payload = event.payload || {};

      // 1. session_meta
      if (eventType === 'session_meta' || (payload.session_id && payload.git)) {
        currentSessionId = payload.session_id || currentSessionId;
        projectPath = payload.cwd || projectPath;
        startedAt = payload.timestamp || startedAt || ts;
        cliVersion = payload.cli_version || cliVersion;
        if (payload.base_instructions?.provenance?.model) {
          activeModel = payload.base_instructions.provenance.model;
        }
      }

      // 2. turn_context
      if (eventType === 'turn_context' || (payload.turn_id && payload.sandbox_policy)) {
        if (payload.model) activeModel = payload.model;
        if (payload.collaboration_mode?.settings?.model) activeModel = payload.collaboration_mode.settings.model;
        if (payload.effort) activeEffort = payload.effort;
        if (payload.collaboration_mode?.settings?.reasoning_effort) activeEffort = payload.collaboration_mode.settings.reasoning_effort;
        if (payload.cwd) projectPath = payload.cwd;
      }

      // 3. world_state
      if (eventType === 'world_state' && payload.state?.model) {
        activeModel = payload.state.model;
      }

      // 4. response_item (tool calls & results)
      if (eventType === 'response_item' || payload.call_id || payload.type === 'message') {
        const itemType = payload.type;

        // User message detection
        if (itemType === 'message' && payload.role === 'user') {
          userMessagesCount++;
        }

        // Custom tool call or function call
        if (itemType === 'custom_tool_call' || itemType === 'function_call') {
          const callId = payload.call_id || payload.id;
          const name = payload.name || 'unknown';
          if (callId) {
            pendingToolCalls.set(callId, { name, callId, ts });
          }
        }

        // Custom tool call output or function call output
        if (itemType === 'custom_tool_call_output' || itemType === 'function_call_output') {
          const callId = payload.call_id || payload.id;
          let outputBytes = 0;
          let combinedText = '';

          if (Array.isArray(payload.output)) {
            for (const out of payload.output) {
              if (typeof out.text === 'string') {
                outputBytes += Buffer.byteLength(out.text, 'utf-8');
                combinedText += out.text + ' ';
              }
            }
          }

          accumulatedToolBytesInTurn += outputBytes;

          // Parse exit code from output text (best-effort)
          let exitCode: number | null = null;
          const exitMatch = combinedText.match(/(?:exit code:?|exited with code|Process exited)\s*(\d+)/i);
          if (exitMatch && exitMatch[1]) {
            exitCode = parseInt(exitMatch[1], 10);
          }

          const callInfo = pendingToolCalls.get(callId);
          const toolName = callInfo?.name || 'unknown';

          toolEvents.push({
            id: payload.id || `tool-${Date.now()}-${toolEvents.length}`,
            session_id: currentSessionId || 'unknown',
            ts,
            name: toolName,
            exit_code: exitCode,
            output_bytes: outputBytes,
            command_hash: null
          });

          if (callId) pendingToolCalls.delete(callId);
        }
      }

      // 5. compacted event
      if (eventType === 'compacted') {
        compactionsCount++;
      }

      // 6. token_usage_record (model call)
      if (eventType === 'token_usage_record' || (payload.usage && payload.turn_token_usage)) {
        modelCallsCount++;
        currentSessionId = payload.session_id || payload.thread_id || currentSessionId;
        const turnUsage = payload.turn_token_usage || payload.usage || {};

        const inputTokens = typeof turnUsage.input_tokens === 'number' ? turnUsage.input_tokens : 0;
        const cachedTokens = typeof turnUsage.cached_input_tokens === 'number' ? turnUsage.cached_input_tokens : 0;
        const outputTokens = typeof turnUsage.output_tokens === 'number' ? turnUsage.output_tokens : 0;
        const reasoningTokens = typeof turnUsage.reasoning_output_tokens === 'number' ? turnUsage.reasoning_output_tokens : 0;

        const turn: Turn = {
          id: payload.turn_id || payload.response_id || `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          session_id: currentSessionId || 'unknown',
          ts,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cached_tokens: cachedTokens,
          reasoning_tokens: reasoningTokens,
          model: activeModel,
          effort: activeEffort,
          tool_output_bytes: accumulatedToolBytesInTurn,
          user_message_index: userMessagesCount,
          call_index: modelCallsCount
        };


        turns.push(turn);
        accumulatedToolBytesInTurn = 0; // reset for next turn
      }
    }

    // Fail-safe: if lines were read but not a single valid JSON object was parsed
    if (lines.length > 0 && validJsonCount === 0 && parseErrorCount > 0) {
      return { turns: [], toolEvents: [], newOffset: startOffset, error: 'unsupported version' };
    }

    if (currentSessionId) {
      sessionData = {
        id: currentSessionId,
        agent: 'codex',
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
      compactionsCount
    };
  }
}
