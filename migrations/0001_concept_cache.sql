CREATE TABLE IF NOT EXISTS concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  content_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('curated', 'ai')),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TEXT
);
CREATE TABLE IF NOT EXISTS generation_limits (
  ip_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  generation_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, day)
);
CREATE INDEX IF NOT EXISTS idx_concepts_status_updated ON concepts(status, updated_at DESC);
PRAGMA optimize;
