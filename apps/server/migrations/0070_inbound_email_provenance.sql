-- Add trusted gateway provenance without relabelling historical actor evidence.
-- Rebuild only the derived public-history projection around the parent replacement.
-- Execute as one migration transaction; no foreign-key enforcement is disabled.
-- External redaction triggers are restored verbatim after the parent rename.
DROP TRIGGER conversation_public_history_event_insert;
DROP TRIGGER conversation_public_history_event_update;
DROP TRIGGER conversation_public_history_event_delete;
DROP TRIGGER conversation_public_history_article_insert;
DROP TRIGGER conversation_public_history_article_visibility_update;
DROP TRIGGER conversation_public_history_article_delete;
DROP TABLE conversation_public_history;
DROP TRIGGER redact_conversation_event_article;
DROP TRIGGER redact_conversation_event_actor;
DROP TRIGGER redact_conversation_event_key;


CREATE TABLE expanded_conversation_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  article_id TEXT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  kind TEXT NOT NULL CHECK (kind IN ('ticket.intake','message.reply','ticket.assignment_changed','ticket.state_changed')),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('api-key','customer','staff','system')),
  actor_id TEXT,
  actor_provenance TEXT NOT NULL CHECK (actor_provenance IN ('api-key','authenticated-customer','mfa-staff','gateway-email')),
  source TEXT NOT NULL CHECK (source IN ('api','portal','widget','dashboard','email')),
  visibility TEXT NOT NULL CHECK (visibility IN ('public','internal')),
  facts TEXT NOT NULL CHECK (json_valid(facts) AND json_type(facts) IS 'object' AND length(CAST(facts AS BLOB)) <= 4096),
  CHECK ((actor_kind='system' AND actor_id IS 'inbound-email' AND actor_provenance='gateway-email' AND source='email'
    AND visibility='public' AND kind IN ('ticket.intake','message.reply'))
    OR (actor_kind<>'system' AND actor_provenance<>'gateway-email' AND source<>'email')),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,ticket_id,sequence),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE
);

INSERT INTO expanded_conversation_events (tenant_id,id,ticket_id,article_id,sequence,schema_version,kind,recorded_at,actor_kind,actor_id,actor_provenance,source,visibility,facts)
SELECT tenant_id,id,ticket_id,article_id,sequence,schema_version,kind,recorded_at,actor_kind,actor_id,actor_provenance,source,visibility,facts FROM conversation_events;
DROP TABLE conversation_events;
ALTER TABLE expanded_conversation_events RENAME TO conversation_events;

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


CREATE INDEX idx_conversation_events_article ON conversation_events(tenant_id,article_id);
CREATE INDEX IF NOT EXISTS idx_conversation_events_operational_metric_projection
  ON conversation_events(tenant_id, ticket_id, sequence, recorded_at);
CREATE INDEX IF NOT EXISTS idx_conversation_events_staff_reply_precondition
  ON conversation_events(tenant_id, ticket_id, kind, sequence);
CREATE INDEX IF NOT EXISTS idx_conversation_events_ticket_kind_visibility_sequence
  ON conversation_events(tenant_id,ticket_id,kind,visibility,sequence);
CREATE INDEX IF NOT EXISTS idx_conversation_events_ticket_article_kind
  ON conversation_events(tenant_id,ticket_id,article_id,kind);

-- Current public-history eligibility projection. It is maintained transactionally
-- with event/article visibility so API and customer paging can use a finite
-- tenant/ticket/sequence index without scanning hidden conversation history.
CREATE TABLE conversation_public_history (
  tenant_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  PRIMARY KEY (tenant_id,event_id),
  UNIQUE (tenant_id,ticket_id,sequence),
  FOREIGN KEY (tenant_id,event_id) REFERENCES conversation_events(tenant_id,id) ON DELETE CASCADE
);

-- Backfill only rows currently eligible under the existing public-history rule.
INSERT INTO conversation_public_history (tenant_id,event_id,ticket_id,sequence)
SELECT e.tenant_id,e.id,e.ticket_id,e.sequence
FROM conversation_events e
LEFT JOIN articles a ON a.tenant_id=e.tenant_id AND a.id=e.article_id AND a.ticket_id=e.ticket_id
WHERE e.visibility='public' AND (
  (e.kind='ticket.intake' AND (e.article_id IS NULL OR a.is_internal=0))
  OR (e.kind='message.reply' AND e.article_id IS NOT NULL AND a.is_internal=0)
);

CREATE TRIGGER conversation_public_history_event_insert AFTER INSERT ON conversation_events BEGIN
  INSERT OR REPLACE INTO conversation_public_history (tenant_id,event_id,ticket_id,sequence)
  SELECT NEW.tenant_id,NEW.id,NEW.ticket_id,NEW.sequence
  WHERE NEW.visibility='public' AND (
    (NEW.kind='ticket.intake' AND (NEW.article_id IS NULL OR EXISTS (
      SELECT 1 FROM articles a WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.article_id AND a.ticket_id=NEW.ticket_id AND a.is_internal=0)))
    OR (NEW.kind='message.reply' AND NEW.article_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM articles a WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.article_id AND a.ticket_id=NEW.ticket_id AND a.is_internal=0))
  );
END;

CREATE TRIGGER conversation_public_history_event_update
AFTER UPDATE OF tenant_id,ticket_id,article_id,sequence,kind,visibility ON conversation_events BEGIN
  DELETE FROM conversation_public_history WHERE tenant_id=OLD.tenant_id AND event_id=OLD.id;
  INSERT OR REPLACE INTO conversation_public_history (tenant_id,event_id,ticket_id,sequence)
  SELECT NEW.tenant_id,NEW.id,NEW.ticket_id,NEW.sequence
  WHERE NEW.visibility='public' AND (
    (NEW.kind='ticket.intake' AND (NEW.article_id IS NULL OR EXISTS (
      SELECT 1 FROM articles a WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.article_id AND a.ticket_id=NEW.ticket_id AND a.is_internal=0)))
    OR (NEW.kind='message.reply' AND NEW.article_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM articles a WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.article_id AND a.ticket_id=NEW.ticket_id AND a.is_internal=0))
  );
END;

CREATE TRIGGER conversation_public_history_event_delete AFTER DELETE ON conversation_events BEGIN
  DELETE FROM conversation_public_history WHERE tenant_id=OLD.tenant_id AND event_id=OLD.id;
END;

CREATE TRIGGER conversation_public_history_article_insert AFTER INSERT ON articles BEGIN
  INSERT OR REPLACE INTO conversation_public_history (tenant_id,event_id,ticket_id,sequence)
  SELECT e.tenant_id,e.id,e.ticket_id,e.sequence FROM conversation_events e
  WHERE e.tenant_id=NEW.tenant_id AND e.article_id=NEW.id AND e.ticket_id=NEW.ticket_id
    AND e.visibility='public' AND (
      (e.kind='ticket.intake' AND NEW.is_internal=0) OR (e.kind='message.reply' AND NEW.is_internal=0)
    );
END;

CREATE TRIGGER conversation_public_history_article_visibility_update
AFTER UPDATE OF tenant_id,id,ticket_id,is_internal ON articles BEGIN
  DELETE FROM conversation_public_history WHERE tenant_id=OLD.tenant_id AND event_id IN (
    SELECT id FROM conversation_events WHERE tenant_id=OLD.tenant_id AND article_id=OLD.id
  );
  INSERT OR REPLACE INTO conversation_public_history (tenant_id,event_id,ticket_id,sequence)
  SELECT e.tenant_id,e.id,e.ticket_id,e.sequence FROM conversation_events e
  WHERE e.tenant_id=NEW.tenant_id AND e.article_id=NEW.id AND e.ticket_id=NEW.ticket_id
    AND e.visibility='public' AND (
      (e.kind='ticket.intake' AND NEW.is_internal=0) OR (e.kind='message.reply' AND NEW.is_internal=0)
    );
END;

CREATE TRIGGER conversation_public_history_article_delete AFTER DELETE ON articles BEGIN
  DELETE FROM conversation_public_history WHERE tenant_id=OLD.tenant_id AND event_id IN (
    SELECT id FROM conversation_events WHERE tenant_id=OLD.tenant_id AND article_id=OLD.id
  );
END;
