-- Preserve only server-observed canonical intake facts for new records.
-- Existing conversations/messages retain NULL and project as `not-recorded`.
ALTER TABLE tickets ADD COLUMN intake_received_at TEXT;
ALTER TABLE tickets ADD COLUMN intake_processed_at TEXT;

ALTER TABLE articles ADD COLUMN intake_source TEXT;
ALTER TABLE articles ADD COLUMN received_at TEXT;
ALTER TABLE articles ADD COLUMN processed_at TEXT;
