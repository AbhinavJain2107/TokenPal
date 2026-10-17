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
}

export interface TurnEventPayload {
  session: Session;
  turn: Turn;
  turnIndex: number;
  isNewTurn: boolean;
}
