ALTER TABLE project_archive_versions ADD COLUMN storage_mode TEXT NOT NULL DEFAULT 'inline';
ALTER TABLE project_archive_versions ADD COLUMN payload_bytes INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS project_archive_chunks (
  workspace_hash TEXT NOT NULL,
  revision INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  payload_text TEXT NOT NULL,
  chunk_checksum TEXT NOT NULL,
  byte_count INTEGER NOT NULL,
  PRIMARY KEY (workspace_hash, revision, chunk_index)
);

CREATE TABLE IF NOT EXISTS archive_uploads (
  workspace_hash TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  archive_checksum TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  project_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_hash, upload_id)
);

CREATE TABLE IF NOT EXISTS archive_upload_chunks (
  workspace_hash TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  payload_text TEXT NOT NULL,
  chunk_checksum TEXT NOT NULL,
  byte_count INTEGER NOT NULL,
  PRIMARY KEY (workspace_hash, upload_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_project_archive_chunks_revision
  ON project_archive_chunks (workspace_hash, revision, chunk_index);

CREATE INDEX IF NOT EXISTS idx_archive_upload_chunks_upload
  ON archive_upload_chunks (workspace_hash, upload_id, chunk_index);
