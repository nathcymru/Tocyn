-- API PATCH has a 200 ticket response, while v1/v2 create and reply receipts
-- remain immutable 201 contracts. Rebuild the constrained receipt table so
-- retries retain the exact persisted update response without changing old rows.
DROP TRIGGER redact_mutation_receipts_ticket;
DROP TRIGGER redact_mutation_receipts_article;
DROP TRIGGER redact_mutation_receipts_attachment;
ALTER TABLE ticket_mutation_receipts RENAME TO ticket_mutation_receipts_pre_update;
DROP INDEX idx_mutation_receipts_expiry;
DROP INDEX idx_mutation_receipts_ticket;
DROP INDEX idx_mutation_receipts_article;

CREATE TABLE ticket_mutation_receipts (
  tenant_id TEXT NOT NULL,
  principal_kind TEXT NOT NULL CHECK (principal_kind IN ('api-key', 'customer')),
  principal_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('api.ticket.create', 'api.ticket.reply', 'api.ticket.update', 'portal.ticket.create', 'portal.ticket.reply')),
  key_hash TEXT NOT NULL CHECK (length(key_hash) = 64),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  fingerprint_version INTEGER NOT NULL CHECK (fingerprint_version = 1),
  response_version INTEGER NOT NULL CHECK (response_version IN (1, 2, 3)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 86400),
  lifecycle TEXT NOT NULL DEFAULT 'completed' CHECK (lifecycle IN ('completed', 'gone')),
  result_ticket_id TEXT,
  result_article_id TEXT,
  response_status INTEGER NOT NULL CHECK (response_status IN (200, 201)),
  response_snapshot TEXT,
  PRIMARY KEY (tenant_id, principal_kind, principal_id, operation, key_hash),
  CHECK (expires_at > created_at),
  CHECK (
    (lifecycle = 'gone' AND response_snapshot IS NULL AND result_ticket_id IS NULL AND result_article_id IS NULL)
    OR (lifecycle = 'completed' AND result_ticket_id IS NOT NULL AND response_snapshot IS NOT NULL
      AND length(CAST(response_snapshot AS BLOB)) <= 262144 AND json_valid(response_snapshot)
      AND json_type(response_snapshot, '$.ticket') IS 'object'
      AND json_type(response_snapshot, '$.version') IS 'integer'
      AND json_extract(response_snapshot, '$.version') IS response_version
      AND ((response_version IN (1,2) AND response_status = 201) OR (response_version = 3 AND response_status = 200 AND operation = 'api.ticket.update'))
      AND (response_version <> 2 OR (json_type(response_snapshot, '$.audit') IS 'array'
        AND json_array_length(response_snapshot, '$.audit') IS 1
        AND json_type(response_snapshot, '$.audit[0].eventId') IS 'text'
        AND length(json_extract(response_snapshot, '$.audit[0].eventId')) > 0))
      AND (operation NOT LIKE '%.reply' OR json_type(response_snapshot, '$.article') IS 'object'))
  )
);
CREATE INDEX idx_mutation_receipts_expiry ON ticket_mutation_receipts(tenant_id, expires_at);
CREATE INDEX idx_mutation_receipts_ticket ON ticket_mutation_receipts(tenant_id, result_ticket_id);
CREATE INDEX idx_mutation_receipts_article ON ticket_mutation_receipts(tenant_id, result_article_id);
INSERT INTO ticket_mutation_receipts SELECT * FROM ticket_mutation_receipts_pre_update;
DROP TABLE ticket_mutation_receipts_pre_update;

CREATE TRIGGER redact_mutation_receipts_ticket AFTER DELETE ON tickets BEGIN
  UPDATE ticket_mutation_receipts SET lifecycle = 'gone', response_snapshot = NULL,
    result_ticket_id = NULL, result_article_id = NULL
    WHERE tenant_id = OLD.tenant_id AND result_ticket_id = OLD.id;
END;
CREATE TRIGGER redact_mutation_receipts_article AFTER DELETE ON articles BEGIN
  UPDATE ticket_mutation_receipts SET lifecycle = 'gone', response_snapshot = NULL,
    result_ticket_id = NULL, result_article_id = NULL
    WHERE tenant_id = OLD.tenant_id AND result_article_id = OLD.id;
END;
CREATE TRIGGER redact_mutation_receipts_attachment AFTER DELETE ON attachments BEGIN
  UPDATE ticket_mutation_receipts SET lifecycle = 'gone', response_snapshot = NULL,
    result_ticket_id = NULL, result_article_id = NULL
    WHERE tenant_id = OLD.tenant_id AND result_article_id = OLD.article_id;
END;
