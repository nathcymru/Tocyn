-- #133 durable, recipient-scoped operator activity. This is a projection of
-- canonical work; it is not an audit stream, permission grant, or retention rule.
CREATE TABLE operator_activities (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
  ticket_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'assignment','mention','customer_reply','sla_risk','resurfaced_work','delivery_intervention'
  )),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 128),
  producer_kind TEXT NOT NULL CHECK (producer_kind IN ('staff','system')),
  producer_id TEXT,
  -- SHA-256 of immutable append fields. It preserves replay safety after a
  -- deleted staff identity is redacted without retaining that identity.
  receipt_fingerprint TEXT NOT NULL CHECK (length(receipt_fingerprint)=64 AND receipt_fingerprint NOT GLOB '*[^0-9a-f]*'),
  facts TEXT NOT NULL CHECK (
    json_valid(facts) AND json_type(facts) IS 'object' AND length(CAST(facts AS BLOB)) <= 1024
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resurfaced_at TEXT,
  read_at TEXT,
  dismissed_at TEXT,
  PRIMARY KEY (tenant_id,id),
  -- One canonical source may notify multiple authorized recipients. A replay is
  -- idempotent only for its tenant, recipient and activity kind.
  UNIQUE (tenant_id,recipient_user_id,kind,source_id),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,recipient_user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE,
  -- A deleted staff producer retains its human provenance with a redacted ID.
  CHECK ((producer_kind='system' AND producer_id IS NULL) OR producer_kind='staff')
);

CREATE INDEX idx_operator_activities_recipient_created
  ON operator_activities(tenant_id,recipient_user_id,created_at DESC,id DESC);
CREATE INDEX idx_operator_activities_recipient_unread
  ON operator_activities(tenant_id,recipient_user_id,created_at DESC,id DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX idx_operator_activities_producer
  ON operator_activities(tenant_id,producer_kind,producer_id)
  WHERE producer_kind='staff' AND producer_id IS NOT NULL;

-- Activity never keeps a deleted staff identity alive. Its staff provenance is
-- retained with a redacted identity; the durable row remains for its recipient
-- unless that recipient or its ticket is deleted.
CREATE TRIGGER redact_operator_activity_producer AFTER DELETE ON users BEGIN
  UPDATE operator_activities SET producer_id=NULL
    WHERE tenant_id=OLD.tenant_id AND producer_kind='staff' AND producer_id=OLD.id;
END;

-- Producer seams ignore only the canonical source uniqueness conflict.
-- Equal receipts are harmless replays;
-- a conflicting reuse or stale authorization aborts the entire caller batch.
CREATE TRIGGER validate_operator_activity_append BEFORE INSERT ON operator_activities BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tickets t JOIN users r ON r.tenant_id=t.tenant_id AND r.id=NEW.recipient_user_id
    WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.ticket_id AND r.role IN ('admin','agent')
      AND (t.group_id IS NULL OR r.role='admin' OR EXISTS (
        SELECT 1 FROM user_groups ug WHERE ug.tenant_id=t.tenant_id AND ug.group_id=t.group_id AND ug.user_id=r.id
      ))
  ) THEN RAISE(ABORT,'operator_activity_recipient_unavailable') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM operator_activities a WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.id
      AND a.receipt_fingerprint<>NEW.receipt_fingerprint
  ) OR EXISTS (
    SELECT 1 FROM operator_activities a WHERE a.tenant_id=NEW.tenant_id AND a.recipient_user_id=NEW.recipient_user_id
      AND a.kind=NEW.kind AND a.source_id=NEW.source_id AND a.receipt_fingerprint<>NEW.receipt_fingerprint
  ) THEN RAISE(ABORT,'operator_activity_receipt_conflict') END;
  -- A deleted staff producer can replay its matching redacted receipt only.
  SELECT CASE WHEN NEW.producer_kind='staff' AND NOT EXISTS (
    SELECT 1 FROM users p WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.producer_id AND p.role IN ('admin','agent')
  ) AND NOT EXISTS (
    SELECT 1 FROM operator_activities a WHERE a.tenant_id=NEW.tenant_id AND a.recipient_user_id=NEW.recipient_user_id
      AND a.kind=NEW.kind AND a.source_id=NEW.source_id AND a.receipt_fingerprint=NEW.receipt_fingerprint
      AND a.producer_kind='staff' AND a.producer_id IS NULL
  ) THEN RAISE(ABORT,'operator_activity_producer_unavailable') END;
END;
