ALTER TABLE settings ADD COLUMN show_download_source_domains INTEGER NOT NULL DEFAULT 1 CHECK (show_download_source_domains IN (0, 1));
