-- Durable claims freeze the ownership manifest while external cleanup runs.
-- Write claims deliberately do not expire: a crashed external writer needs reconciliation.
CREATE TABLE ticket_cleanup_claims (
  tenant_id TEXT NOT NULL, ticket_id TEXT NOT NULL, token TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('retention', 'write', 'finalizing')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, ticket_id),
  FOREIGN KEY (tenant_id, ticket_id) REFERENCES tickets(tenant_id, id) ON DELETE CASCADE
);
CREATE TRIGGER retention_freeze_tickets_update BEFORE UPDATE ON tickets
WHEN EXISTS (SELECT 1 FROM ticket_cleanup_claims WHERE tenant_id = OLD.tenant_id AND ticket_id = OLD.id AND mode = 'retention') OR EXISTS (SELECT 1 FROM ticket_cleanup_claims WHERE tenant_id = NEW.tenant_id AND ticket_id = NEW.id AND mode = 'retention')
BEGIN
  SELECT RAISE(ABORT, 'Ticket retention in progress');
END;
CREATE TRIGGER retention_freeze_tickets_delete BEFORE DELETE ON tickets
WHEN EXISTS (SELECT 1 FROM ticket_cleanup_claims WHERE tenant_id = OLD.tenant_id AND ticket_id = OLD.id AND mode = 'retention')
BEGIN
  SELECT RAISE(ABORT, 'Ticket retention in progress');
END;
CREATE TRIGGER retention_freeze_articles_insert BEFORE INSERT ON articles
WHEN EXISTS (SELECT 1 FROM ticket_cleanup_claims WHERE tenant_id = NEW.tenant_id AND ticket_id = NEW.ticket_id AND mode = 'retention')
BEGIN
  SELECT RAISE(ABORT, 'Ticket retention in progress');
END;
CREATE TRIGGER retention_freeze_articles_update BEFORE UPDATE ON articles
WHEN EXISTS (SELECT 1 FROM ticket_cleanup_claims WHERE tenant_id = OLD.tenant_id AND ticket_id = OLD.ticket_id AND mode = 'retention') OR EXISTS (SELECT 1 FROM ticket_cleanup_claims WHERE tenant_id = NEW.tenant_id AND ticket_id = NEW.ticket_id AND mode = 'retention')
BEGIN
  SELECT RAISE(ABORT, 'Ticket retention in progress');
END;
CREATE TRIGGER retention_freeze_articles_delete BEFORE DELETE ON articles
WHEN EXISTS (SELECT 1 FROM ticket_cleanup_claims WHERE tenant_id = OLD.tenant_id AND ticket_id = OLD.ticket_id AND mode = 'retention')
BEGIN
  SELECT RAISE(ABORT, 'Ticket retention in progress');
END;
CREATE TRIGGER retention_freeze_attachments_insert BEFORE INSERT ON attachments
WHEN EXISTS (SELECT 1 FROM ticket_cleanup_claims WHERE tenant_id = NEW.tenant_id AND ticket_id = (SELECT ticket_id FROM articles WHERE tenant_id = NEW.tenant_id AND id = NEW.article_id) AND mode = 'retention')
BEGIN
  SELECT RAISE(ABORT, 'Ticket retention in progress');
END;
CREATE TRIGGER retention_freeze_attachments_update BEFORE UPDATE ON attachments
WHEN EXISTS (SELECT 1 FROM ticket_cleanup_claims WHERE tenant_id = OLD.tenant_id AND ticket_id = (SELECT ticket_id FROM articles WHERE tenant_id = OLD.tenant_id AND id = OLD.article_id) AND mode = 'retention') OR EXISTS (SELECT 1 FROM ticket_cleanup_claims WHERE tenant_id = NEW.tenant_id AND ticket_id = (SELECT ticket_id FROM articles WHERE tenant_id = NEW.tenant_id AND id = NEW.article_id) AND mode = 'retention')
BEGIN
  SELECT RAISE(ABORT, 'Ticket retention in progress');
END;
CREATE TRIGGER retention_freeze_attachments_delete BEFORE DELETE ON attachments
WHEN EXISTS (SELECT 1 FROM ticket_cleanup_claims WHERE tenant_id = OLD.tenant_id AND ticket_id = (SELECT ticket_id FROM articles WHERE tenant_id = OLD.tenant_id AND id = OLD.article_id) AND mode = 'retention')
BEGIN
  SELECT RAISE(ABORT, 'Ticket retention in progress');
END;
