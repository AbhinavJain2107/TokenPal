export type SessionStatus = 'active' | 'idle' | 'completed' | 'abandoned';

export interface Session {
  id: string;
  agent: string;
  project_path: string | null;
  started_at: string;
  last_event_at: string;
  model: string | null;
  status: SessionStatus;
}

export interface Turn {
  id: string;
  session_id: string;
  ts: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  model: string | null;
  effort: string | null;
  tool_output_bytes: number;
  user_message_index?: number;
  call_index?: number;
}

export interface ToolEvent {
  id: string;
  session_id: string;
  ts: string;
  name: string;
  exit_code: number | null;
  output_bytes: number;
  command_hash: string | null;
}

export interface Alert {
  id: string;
  session_id: string;
  ts: string;
  rule: string;
  severity: 'green' | 'yellow' | 'red';
  shown: number; // 0 or 1
  action_taken: string | null;
}

export interface Handoff {
  id: string;
  session_id: string;
  ts: string;
  path: string;
}

export interface Setting {
  key: string;
  value: string;
}

export interface FileOffset {
  file_path: string;
  offset: number;
  last_mtime: number;
  last_session_id: string | null;
}

export interface MeterReading {
  sessionId?: string;
  ts: string;
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number;
  planType?: string;
}

export interface TaskLifecycleEvent {
  type: 'task_started' | 'task_complete';
  turnId?: string;
  sessionId?: string;
  ts: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export interface MeterSnapshot {
  id?: number;
  session_id?: string | null;
  ts: string;
  used_percent: number;
  window_minutes: number;
  resets_at: number;
  plan_type?: string | null;
}

export interface QuotaReset {
  id?: number;
  ts: string;
  prev_used_percent: number | null;
  prev_resets_at: number | null;
  new_resets_at: number;
  is_early: number; // 0 or 1
}

export interface MeterStatus {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number;
  planType: string;
  timeToResetFormatted: string;
  resetsAtLocal?: string;
  asOfTs?: string;
  asOfLocal?: string;
  isStale?: boolean;
  staleReason?: string;
  percentBar: string;
  earlyResetsCount: number;
  earlyResetsNote?: string;
  projectedExhaustionHours?: number;
  projectedExhaustionText?: string;
  activeModel?: string | null;
  modelBadgeText?: string;
}

export interface UserRequestCost {
  turnId: string;
  startTs: string;
  completeTs: string;
  startUsedPercent: number;
  endUsedPercent: number;
  deltaPercent: number;
  costDisplay: string;
  spannedReset: boolean;
  model?: string | null;
  callsCount: number;
  tokensCount: number;
}

export interface ParseResult {
  session?: Partial<Session>;
  turns: Turn[];
  toolEvents: ToolEvent[];
  newOffset: number;
  cliVersion?: string;
  error?: string;
  userMessagesCount?: number;
  modelCallsCount?: number;
  compactionsCount?: number;
  meterReadings?: MeterReading[];
  taskEvents?: TaskLifecycleEvent[];
}

export interface TurnEventPayload {
  session: Session;
  turn: Turn;
  turnIndex: number;
  isNewTurn: boolean;
  requestCost?: UserRequestCost;
  meterStatus?: MeterStatus;
}

