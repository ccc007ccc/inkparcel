-- Retain identity and secret material needed to verify previously issued markers.
ALTER TABLE keys ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1));
ALTER TABLE users ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1));
CREATE INDEX keys_deleted ON keys(deleted, created_at);
CREATE INDEX users_deleted_seen ON users(deleted, last_seen_at);
