import { CodexAdapter } from '../adapters/codex.js';
import { AgentAdapter } from '../adapters/interface.js';
import { Session, ToolEvent } from '../types.js';


export interface ReplayTurnSummary {
  turnIndex: number;
  turnId: string;
  timestamp: string;
  model: string | null;
  effort: string | null;
  inputTokens: number; // context size proxy
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  toolOutputBytes: number;
  cumulativeInputTokens: number;
  cumulativeTotalTokens: number;
}

export interface ReplayResult {
  session?: Session;
  cliVersion?: string;
  turns: ReplayTurnSummary[];
  toolEvents: ToolEvent[];
  maxContextSize: number;
  totalTokens: number;
  error?: string;
}

export async function replaySessionFile(
  filePath: string,
  adapters: AgentAdapter[] = [new CodexAdapter()]
): Promise<ReplayResult> {
  let adapter: AgentAdapter | undefined;
  for (const a of adapters) {
    if (a.canHandle(filePath)) {
      adapter = a;
      break;
    }
  }

  if (!adapter) {
    return {
      turns: [],
      toolEvents: [],
      maxContextSize: 0,
      totalTokens: 0,
      error: 'No compatible adapter found for this file'
    };
  }

  const parseResult = await adapter.parseIncremental(filePath, 0);

  if (parseResult.error) {
    return {
      turns: [],
      toolEvents: [],
      maxContextSize: 0,
      totalTokens: 0,
      error: parseResult.error
    };
  }

  let cumulativeInput = 0;
  let cumulativeTotal = 0;
  let maxContext = 0;

  const summaries: ReplayTurnSummary[] = parseResult.turns.map((t, idx) => {
    cumulativeInput += t.input_tokens;
    cumulativeTotal += (t.input_tokens + t.output_tokens);
    if (t.input_tokens > maxContext) {
      maxContext = t.input_tokens;
    }

    return {
      turnIndex: idx + 1,
      turnId: t.id,
      timestamp: t.ts,
      model: t.model,
      effort: t.effort,
      inputTokens: t.input_tokens,
      cachedTokens: t.cached_tokens,
      outputTokens: t.output_tokens,
      reasoningTokens: t.reasoning_tokens,
      toolOutputBytes: t.tool_output_bytes,
      cumulativeInputTokens: cumulativeInput,
      cumulativeTotalTokens: cumulativeTotal
    };
  });

  const sessionObj: Session | undefined = parseResult.session && parseResult.session.id ? {
    id: parseResult.session.id,
    agent: parseResult.session.agent || adapter.id,
    project_path: parseResult.session.project_path || null,
    started_at: parseResult.session.started_at || new Date().toISOString(),
    last_event_at: parseResult.session.last_event_at || new Date().toISOString(),
    model: parseResult.session.model || null,
    status: (parseResult.session.status as any) || 'completed'
  } : undefined;

  return {
    session: sessionObj,
    cliVersion: parseResult.cliVersion,
    turns: summaries,
    toolEvents: parseResult.toolEvents,
    maxContextSize: maxContext,
    totalTokens: cumulativeTotal
  };
}
