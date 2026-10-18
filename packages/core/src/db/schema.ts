export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  project_path TEXT,
  started_at TEXT NOT NULL,
  last_event_at TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  model TEXT,
  effort TEXT,
  tool_output_bytes INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_turns_session_id ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_ts ON turns(ts);

CREATE TABLE IF NOT EXISTS tool_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  name TEXT NOT NULL,
  exit_code INTEGER,
  output_bytes INTEGER NOT NULL DEFAULT 0,
  command_hash TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tool_events_session_id ON tool_events(session_id);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  ts TEXT NOT NULL,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL,
  shown INTEGER NOT NULL DEFAULT 0,
  action_taken TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alerts_session_id ON alerts(session_id);

CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  path TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_offsets (
  file_path TEXT PRIMARY KEY,
  offset INTEGER NOT NULL DEFAULT 0,
  last_mtime INTEGER NOT NULL DEFAULT 0,
  last_session_id TEXT
);

CREATE TABLE IF NOT EXISTS meter_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  ts TEXT NOT NULL,
  used_percent REAL NOT NULL,
  window_minutes INTEGER NOT NULL,
  resets_at INTEGER NOT NULL,
  plan_type TEXT
);

CREATE INDEX IF NOT EXISTS idx_meter_snapshots_ts ON meter_snapshots(ts);

CREATE TABLE IF NOT EXISTS quota_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  prev_used_percent REAL,
  prev_resets_at INTEGER,
  new_resets_at INTEGER NOT NULL,
  is_early INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_quota_resets_ts ON quota_resets(ts);
`;
