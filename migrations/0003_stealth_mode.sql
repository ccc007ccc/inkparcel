ALTER TABLE settings ADD COLUMN stealth_mode INTEGER NOT NULL DEFAULT 0 CHECK (stealth_mode IN (0, 1));
