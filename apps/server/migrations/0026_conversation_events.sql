-- Preserve immutable live v1 responses while allowing new audited v2 responses.
DROP TRIGGER redact_mutation_receipts_ticket;
DROP TRIGGER redact_mutation_receipts_article;
DROP TRIGGER redact_mutation_receipts_attachment;
ALTER TABLE ticket_mutation_receipts RENAME TO ticket_mutation_receipts_v1;
DROP INDEX idx_mutation_receipts_expiry;
DROP INDEX idx_mutation_receipts_ticket;
DROP INDEX idx_mutation_receipts_article;
-- Completed receipts only: the mutation and this INSERT commit in one batch.
CREATE TABLE ticket_mutation_receipts (
  tenant_id TEXT NOT NULL,
  principal_kind TEXT NOT NULL CHECK (principal_kind IN ('api-key', 'customer')),
  principal_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('api.ticket.create', 'api.ticket.reply', 'portal.ticket.create', 'portal.ticket.reply')),
  key_hash TEXT NOT NULL CHECK (length(key_hash) = 64),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  fingerprint_version INTEGER NOT NULL CHECK (fingerprint_version = 1),
  response_version INTEGER NOT NULL CHECK (response_version IN (1, 2)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 86400),
  lifecycle TEXT NOT NULL DEFAULT 'completed' CHECK (lifecycle IN ('completed', 'gone')),
  result_ticket_id TEXT,
  result_article_id TEXT,
  response_status INTEGER NOT NULL CHECK (response_status = 201),
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
      AND (response_version = 1 OR (json_type(response_snapshot, '$.audit') IS 'array'
        AND json_array_length(response_snapshot, '$.audit') IS 1
        AND json_type(response_snapshot, '$.audit[0].eventId') IS 'text'
        AND length(json_extract(response_snapshot, '$.audit[0].eventId')) > 0))
      AND (operation NOT LIKE '%.reply' OR json_type(response_snapshot, '$.article') IS 'object'))
  )
);
CREATE INDEX idx_mutation_receipts_expiry ON ticket_mutation_receipts(tenant_id, expires_at);
CREATE INDEX idx_mutation_receipts_ticket ON ticket_mutation_receipts(tenant_id, result_ticket_id);
CREATE INDEX idx_mutation_receipts_article ON ticket_mutation_receipts(tenant_id, result_article_id);

INSERT INTO ticket_mutation_receipts SELECT * FROM ticket_mutation_receipts_v1;
DROP TABLE ticket_mutation_receipts_v1;
-- Preserve deduplication until its original expiry without retaining erased data.
-- Triggers cover repository, retention, and direct scoped SQL deletion paths.
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

-- Fixed conversation facts only. No message bodies, credentials, or delivery claims.
CREATE TABLE conversation_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  article_id TEXT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  kind TEXT NOT NULL CHECK (kind IN ('ticket.intake','message.reply','ticket.assignment_changed','ticket.state_changed')),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('api-key','customer','staff')),
  actor_id TEXT,
  actor_provenance TEXT NOT NULL CHECK (actor_provenance IN ('api-key','authenticated-customer','mfa-staff')),
  source TEXT NOT NULL CHECK (source IN ('api','portal','widget','dashboard')),
  visibility TEXT NOT NULL CHECK (visibility IN ('public','internal')),
  facts TEXT NOT NULL CHECK (json_valid(facts) AND json_type(facts) IS 'object' AND length(CAST(facts AS BLOB)) <= 4096),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,ticket_id,sequence),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_conversation_events_article ON conversation_events(tenant_id,article_id);
CREATE TRIGGER redact_conversation_event_article AFTER DELETE ON articles BEGIN
  UPDATE conversation_events SET article_id = NULL WHERE tenant_id = OLD.tenant_id AND article_id = OLD.id;
END;
CREATE TRIGGER redact_conversation_event_actor AFTER DELETE ON users BEGIN
  UPDATE conversation_events SET actor_id = NULL
    WHERE tenant_id = OLD.tenant_id AND actor_kind IN ('customer','staff') AND actor_id = OLD.id;
  UPDATE conversation_events SET facts = json_set(facts,'$.before.assignedTo',NULL)
    WHERE tenant_id = OLD.tenant_id AND json_extract(facts,'$.before.assignedTo') = OLD.id;
  UPDATE conversation_events SET facts = json_set(facts,'$.after.assignedTo',NULL)
    WHERE tenant_id = OLD.tenant_id AND json_extract(facts,'$.after.assignedTo') = OLD.id;
  UPDATE conversation_events SET facts = json_set(facts,'$.initial.assignedTo',NULL)
    WHERE tenant_id = OLD.tenant_id AND json_extract(facts,'$.initial.assignedTo') = OLD.id;
END;
CREATE TRIGGER redact_conversation_event_key AFTER DELETE ON api_keys BEGIN
  UPDATE conversation_events SET actor_id = NULL
    WHERE tenant_id = OLD.tenant_id AND actor_kind = 'api-key' AND actor_id = OLD.id;
END;
