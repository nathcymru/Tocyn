-- Versioning is deliberately additive: historic article and draft bytes retain
-- their literal plain-text meaning, and all future rows name an approved format.
ALTER TABLE articles ADD COLUMN body_format TEXT NOT NULL DEFAULT 'plain'
  CHECK (body_format IN ('plain', 'markdown-v1'));

ALTER TABLE operator_drafts ADD COLUMN body_format TEXT NOT NULL DEFAULT 'plain'
  CHECK (body_format IN ('plain', 'markdown-v1'));
