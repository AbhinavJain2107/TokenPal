import { CodexAdapter } from '../adapters/codex.js';
import { AgentAdapter } from '../adapters/interface.js';
import { Session, ToolEvent } from '../types.js';
import { RulesEngine } from '../rules/engine.js';
import { RuleSignal, Severity, RuleThresholds } from '../rules/types.js';

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
  state: Severity;
  alert: RuleSignal | null;
}

export interface ReplayResult {
  session?: Session;
  cliVersion?: string;
  turns: ReplayTurnSummary[];
  toolEvents: ToolEvent[];
  maxContextSize: number;
  totalTokens: number;
  alerts: { turnIndex: number; alert: RuleSignal }[];
  error?: string;
}

export async function replaySessionFile(
  filePath: string,
  adapters: AgentAdapter[] = [new CodexAdapter()],
  thresholds?: Partial<RuleThresholds>
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
      alerts: [],
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
      alerts: [],
      error: parseResult.error
    };
  }

  const sessionObj: Session = parseResult.session && parseResult.session.id ? {
    id: parseResult.session.id,
    agent: parseResult.session.agent || adapter.id,
    project_path: parseResult.session.project_path || null,
    started_at: parseResult.session.started_at || new Date().toISOString(),
    last_event_at: parseResult.session.last_event_at || new Date().toISOString(),
    model: parseResult.session.model || null,
    status: (parseResult.session.status as any) || 'completed'
  } : {
    id: 'unknown-session',
    agent: adapter.id,
    project_path: null,
    started_at: new Date().toISOString(),
    last_event_at: new Date().toISOString(),
    model: null,
    status: 'completed'
  };

  const engine = new RulesEngine(thresholds);
  let cumulativeInput = 0;
  let cumulativeTotal = 0;
  let maxContext = 0;
  const turnsProcessedSoFar: typeof parseResult.turns = [];
  const alertsFired: { turnIndex: number; alert: RuleSignal }[] = [];

  const summaries: ReplayTurnSummary[] = parseResult.turns.map((t, idx) => {
    cumulativeInput += t.input_tokens;
    cumulativeTotal += (t.input_tokens + t.output_tokens);
    if (t.input_tokens > maxContext) {
      maxContext = t.input_tokens;
    }

    turnsProcessedSoFar.push(t);

    // Evaluate rules up to this turn
    const relevantTools = parseResult.toolEvents.filter(te => te.ts <= t.ts);
    const evalResult = engine.evaluate(sessionObj, turnsProcessedSoFar, relevantTools, true);

    if (evalResult.shouldAlert && evalResult.primaryAlert) {
      alertsFired.push({
        turnIndex: idx + 1,
        alert: evalResult.primaryAlert
      });
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
      cumulativeTotalTokens: cumulativeTotal,
      state: evalResult.state,
      alert: evalResult.shouldAlert ? evalResult.primaryAlert : null
    };
  });

  return {
    session: sessionObj,
    cliVersion: parseResult.cliVersion,
    turns: summaries,
    toolEvents: parseResult.toolEvents,
    maxContextSize: maxContext,
    totalTokens: cumulativeTotal,
    alerts: alertsFired
  };
}
