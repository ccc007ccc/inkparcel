ALTER TABLE settings ADD COLUMN icon_version TEXT;
CREATE TABLE site_icon (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version TEXT NOT NULL,
  bytes BLOB NOT NULL
);
