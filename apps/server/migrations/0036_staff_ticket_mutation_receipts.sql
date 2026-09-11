-- #64 staff receipts retain the existing mutation receipt's 24-hour lifetime.
-- 0035 is reserved for #68 article/draft format; this migration adds no format column.
CREATE TABLE staff_ticket_mutation_receipts (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('dashboard.ticket.create','dashboard.ticket.reply')),
  key_hash TEXT NOT NULL CHECK (length(key_hash)=64),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash)=64),
  fingerprint_version INTEGER NOT NULL DEFAULT 1 CHECK (fingerprint_version=1),
  response_version INTEGER NOT NULL DEFAULT 1 CHECK (response_version=1),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch()+86400),
  lifecycle TEXT NOT NULL DEFAULT 'completed' CHECK (lifecycle IN ('completed','gone')),
  result_ticket_id TEXT,
  result_article_id TEXT,
  response_status INTEGER NOT NULL DEFAULT 201 CHECK (response_status=201),
  response_snapshot TEXT,
  PRIMARY KEY (tenant_id,principal_id,operation,key_hash),
  CHECK (expires_at>created_at),
  CHECK ((lifecycle='gone' AND response_snapshot IS NULL AND result_ticket_id IS NULL AND result_article_id IS NULL)
    OR (lifecycle='completed' AND result_ticket_id IS NOT NULL AND result_article_id IS NOT NULL
      AND response_snapshot IS NOT NULL AND length(CAST(response_snapshot AS BLOB))<=262144
      AND json_valid(response_snapshot) AND json_extract(response_snapshot,'$.staffVersion') IS 1
      AND json_extract(response_snapshot,'$.staffBodyFormat') IN ('plain','markdown-v1')
      AND json_type(response_snapshot,'$.ticket') IS 'object' AND json_type(response_snapshot,'$.article') IS 'object'))
);
CREATE INDEX idx_staff_mutation_receipts_expiry ON staff_ticket_mutation_receipts(tenant_id,principal_id,expires_at);
CREATE INDEX idx_staff_mutation_receipts_ticket ON staff_ticket_mutation_receipts(tenant_id,result_ticket_id);
CREATE INDEX idx_staff_mutation_receipts_article ON staff_ticket_mutation_receipts(tenant_id,result_article_id);
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
-- One non-sensitive assertion row per tenant; a failed CHECK rolls back the full batch.
CREATE TABLE staff_mutation_assertion (tenant_id TEXT PRIMARY KEY, accepted INTEGER NOT NULL CHECK (accepted=1));
