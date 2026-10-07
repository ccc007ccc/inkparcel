PRAGMA foreign_keys = ON;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  site_name TEXT NOT NULL DEFAULT 'InkParcel',
  admin_path TEXT NOT NULL UNIQUE,
  password_verifier TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  auth_version INTEGER NOT NULL DEFAULT 1,
  ip_retention_days INTEGER NOT NULL DEFAULT 30 CHECK (ip_retention_days BETWEEN 0 AND 3650),
  created_at TEXT NOT NULL
);
CREATE TABLE keys (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL,
  secret_digest TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1))
);
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX folders_sibling_name ON folders(COALESCE(parent_id, ''), name);
CREATE TABLE folder_keys (
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL REFERENCES keys(id) ON DELETE RESTRICT,
  PRIMARY KEY (folder_id, key_id)
);
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  folder_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL CHECK (size > 0),
  fingerprint TEXT NOT NULL,
  handler_version TEXT NOT NULL DEFAULT 'apk-v1',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'deleted')),
  object_deleted INTEGER NOT NULL DEFAULT 0 CHECK (object_deleted IN (0, 1)),
  uploaded_at TEXT NOT NULL
);
CREATE INDEX files_folder_status ON files(folder_id, status, uploaded_at);
CREATE TABLE file_keys (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL REFERENCES keys(id) ON DELETE RESTRICT,
  PRIMARY KEY (file_id, key_id)
);
CREATE INDEX file_keys_key ON file_keys(key_id, file_id);
CREATE TABLE uploads (
  file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  multipart_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading', 'completing', 'completed', 'aborting', 'aborted', 'failed')),
  updated_at TEXT NOT NULL
);
CREATE TABLE upload_parts (
  file_id TEXT NOT NULL REFERENCES uploads(file_id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  etag TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (file_id, part_number)
);
CREATE TABLE upload_part_locks (
  file_id TEXT NOT NULL REFERENCES uploads(file_id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (file_id, part_number)
);
CREATE TABLE downloads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  key_id TEXT NOT NULL REFERENCES keys(id) ON DELETE RESTRICT,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  signed_name TEXT NOT NULL,
  marker TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ip TEXT,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'started'))
);
CREATE INDEX downloads_user_time ON downloads(user_id, created_at);
CREATE INDEX downloads_created ON downloads(created_at);
CREATE INDEX downloads_file ON downloads(file_id);
CREATE INDEX downloads_key ON downloads(key_id);
CREATE TABLE rate_limits (
  id TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL
);
