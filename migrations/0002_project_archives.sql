CREATE TABLE IF NOT EXISTS archive_workspaces (
  workspace_hash TEXT PRIMARY KEY,
  current_revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_archive_versions (
  workspace_hash TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  project_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_hash, revision)
);

CREATE INDEX IF NOT EXISTS idx_project_archive_versions_created
  ON project_archive_versions (workspace_hash, revision DESC);
