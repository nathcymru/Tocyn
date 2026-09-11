-- Dashboard PATCH retains its established 200 { success: true } contract, but
-- needs a durable ticket-only receipt. Legacy staff create/reply receipts stay
-- immutable v1 records and retain their article redaction behavior.
DROP TRIGGER redact_staff_mutation_receipts_ticket;
DROP TRIGGER redact_staff_mutation_receipts_article;
DROP TRIGGER redact_staff_mutation_receipts_attachment;
ALTER TABLE staff_ticket_mutation_receipts RENAME TO staff_ticket_mutation_receipts_pre_update;
DROP INDEX idx_staff_mutation_receipts_expiry;
DROP INDEX idx_staff_mutation_receipts_ticket;
DROP INDEX idx_staff_mutation_receipts_article;

CREATE TABLE staff_ticket_mutation_receipts (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('dashboard.ticket.create','dashboard.ticket.reply','dashboard.ticket.update')),
  key_hash TEXT NOT NULL CHECK (length(key_hash)=64),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash)=64),
  fingerprint_version INTEGER NOT NULL DEFAULT 1 CHECK (fingerprint_version=1),
  response_version INTEGER NOT NULL DEFAULT 1 CHECK (response_version IN (1,2)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch()+86400),
  lifecycle TEXT NOT NULL DEFAULT 'completed' CHECK (lifecycle IN ('completed','gone')),
  result_ticket_id TEXT,
  result_article_id TEXT,
  response_status INTEGER NOT NULL DEFAULT 201 CHECK (response_status IN (200,201)),
  response_snapshot TEXT,
  PRIMARY KEY (tenant_id,principal_id,operation,key_hash),
  CHECK (expires_at>created_at),
  CHECK ((lifecycle='gone' AND response_snapshot IS NULL AND result_ticket_id IS NULL AND result_article_id IS NULL)
    OR (lifecycle='completed' AND result_ticket_id IS NOT NULL AND response_snapshot IS NOT NULL
      AND length(CAST(response_snapshot AS BLOB))<=262144 AND json_valid(response_snapshot)
      AND json_type(response_snapshot,'$.ticket') IS 'object'
      AND json_type(response_snapshot,'$.staffVersion') IS 'integer'
      AND json_extract(response_snapshot,'$.staffVersion') IS response_version
      AND ((response_version=1 AND response_status=201 AND result_article_id IS NOT NULL
        AND json_extract(response_snapshot,'$.staffBodyFormat') IN ('plain','markdown-v1')
        AND json_type(response_snapshot,'$.article') IS 'object')
        OR (response_version=2 AND response_status=200 AND operation='dashboard.ticket.update' AND result_article_id IS NULL)))));
CREATE INDEX idx_staff_mutation_receipts_expiry ON staff_ticket_mutation_receipts(tenant_id,principal_id,expires_at);
CREATE INDEX idx_staff_mutation_receipts_ticket ON staff_ticket_mutation_receipts(tenant_id,result_ticket_id);
CREATE INDEX idx_staff_mutation_receipts_article ON staff_ticket_mutation_receipts(tenant_id,result_article_id);
INSERT INTO staff_ticket_mutation_receipts SELECT * FROM staff_ticket_mutation_receipts_pre_update;
DROP TABLE staff_ticket_mutation_receipts_pre_update;

CREATE TRIGGER redact_staff_mutation_receipts_ticket AFTER DELETE ON tickets BEGIN
  UPDATE staff_ticket_mutation_receipts SET lifecycle='gone',response_snapshot=NULL,result_ticket_id=NULL,result_article_id=NULL
    WHERE tenant_id=OLD.tenant_id AND result_ticket_id=OLD.id;
END;
CREATE TRIGGER redact_staff_mutation_receipts_article AFTER DELETE ON articles BEGIN
  UPDATE staff_ticket_mutation_receipts SET lifecycle='gone',response_snapshot=NULL,result_ticket_id=NULL,result_article_id=NULL
    WHERE tenant_id=OLD.tenant_id AND result_article_id=OLD.id;
END;
CREATE TRIGGER redact_staff_mutation_receipts_attachment AFTER DELETE ON attachments BEGIN
  UPDATE staff_ticket_mutation_receipts SET lifecycle='gone',response_snapshot=NULL,result_ticket_id=NULL,result_article_id=NULL
    WHERE tenant_id=OLD.tenant_id AND result_article_id=OLD.article_id;
END;
