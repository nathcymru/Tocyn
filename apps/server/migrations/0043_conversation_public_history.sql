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
