CREATE TABLE IF NOT EXISTS concept_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id INTEGER NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE,
  UNIQUE (concept_id, normalized_alias)
);

CREATE TABLE IF NOT EXISTS lesson_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  engine TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('curated', 'ai')),
  validation_status TEXT NOT NULL CHECK (
    validation_status IN ('pending', 'schema-valid', 'reviewed', 'rejected')
  ),
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE,
  UNIQUE (concept_id, version)
);

CREATE TABLE IF NOT EXISTS generation_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_query TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('started', 'completed', 'failed')
  ),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS lesson_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_version_id INTEGER NOT NULL,
  event_id TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lesson_version_id) REFERENCES lesson_versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_concept_aliases_normalized
ON concept_aliases(normalized_alias);

CREATE INDEX IF NOT EXISTS idx_lesson_versions_concept_version
ON lesson_versions(concept_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_generation_requests_query_created
ON generation_requests(normalized_query, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lesson_feedback_version
ON lesson_feedback(lesson_version_id);

PRAGMA optimize;

