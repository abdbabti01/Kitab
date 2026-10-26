-- Append-only. Adds atomic usage counters, cross-instance generation leases,
-- generation provenance, mission-scoped feedback, learning events and tutor audit.

CREATE TABLE IF NOT EXISTS usage_counters (
  scope TEXT NOT NULL,          -- e.g. generate-ip, generate-session, generate-global, tutor-ip
  subject TEXT NOT NULL,        -- hashed IP / hashed session / 'global'
  day TEXT NOT NULL,            -- UTC YYYY-MM-DD
  count INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, subject, day)
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  cache_key TEXT PRIMARY KEY,   -- prompt version + schema version + normalized concept
  normalized_query TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'released')),
  owner TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  version_id INTEGER,
  error_code TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE generation_requests ADD COLUMN prompt_version TEXT;
ALTER TABLE generation_requests ADD COLUMN schema_version INTEGER;
ALTER TABLE generation_requests ADD COLUMN validation_outcome TEXT;
ALTER TABLE generation_requests ADD COLUMN inference_calls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE generation_requests ADD COLUMN cache_hit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE generation_requests ADD COLUMN latency_ms INTEGER;
ALTER TABLE generation_requests ADD COLUMN input_tokens INTEGER;
ALTER TABLE generation_requests ADD COLUMN output_tokens INTEGER;
ALTER TABLE generation_requests ADD COLUMN lesson_version_id INTEGER;

CREATE TABLE IF NOT EXISTS mission_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL,
  mission_version TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  scenario_key TEXT NOT NULL,
  frame_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS learning_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_hash TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('prediction-submitted', 'mission-mastered', 'attempt-finished')),
  mission_id TEXT NOT NULL,
  mission_version TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  scenario_key TEXT NOT NULL,
  correct INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tutor_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL,
  mission_version TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  scenario_key TEXT NOT NULL,
  frame_index INTEGER NOT NULL,
  intent TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ai', 'fallback')),
  reason TEXT,
  model TEXT,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mission_feedback_mission ON mission_feedback(mission_id, mission_version);
CREATE INDEX IF NOT EXISTS idx_learning_events_mission ON learning_events(mission_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tutor_requests_mission ON tutor_requests(mission_id, created_at);
