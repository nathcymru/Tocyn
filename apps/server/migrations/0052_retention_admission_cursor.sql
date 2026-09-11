-- #64: trusted scheduled-retention cursors and recoverable external work.
CREATE TABLE retention_scheduler_cursors (
  cursor_name TEXT PRIMARY KEY,
  tenant_id TEXT,
  rule_id TEXT,
  ticket_id TEXT,
  ticket_updated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE retention_ticket_progress (
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  -- The rule and ticket snapshot that authorized the irreversible freeze.
  -- A pre-existing claim without this row is never adopted by the scheduler.
  rule_id TEXT NOT NULL,
  rule_conditions TEXT,
  rule_action_config TEXT NOT NULL,
  candidate_updated_at TEXT NOT NULL,
  attachment_article_id TEXT,
  attachment_id TEXT,
  body_article_id TEXT,
  legacy_article_id TEXT,
  legacy_offset INTEGER NOT NULL DEFAULT 0 CHECK (legacy_offset >= 0),
  attachments_done INTEGER NOT NULL DEFAULT 0 CHECK (attachments_done IN (0,1)),
  bodies_done INTEGER NOT NULL DEFAULT 0 CHECK (bodies_done IN (0,1)),
  legacy_done INTEGER NOT NULL DEFAULT 0 CHECK (legacy_done IN (0,1)),
  finalization_started INTEGER NOT NULL DEFAULT 0 CHECK (finalization_started IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,ticket_id),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE retention_cleanup_work (
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('attachment','article_body','legacy_vector','versioned_vector','finalize')),
  state TEXT NOT NULL CHECK (state IN ('pending','claimed','uncertain','complete')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 1000000),
  -- Every lease transition is fenced by this monotonically increasing attempt.
  -- A recovered lease may be claimed again, but an older runner cannot settle it.
  attempt_token INTEGER NOT NULL DEFAULT 0 CHECK (attempt_token >= 0 AND attempt_token <= 1000000),
  authority_revision INTEGER,
  recovery_reservation TEXT,
  authority_holder_id TEXT,
  authority_operation_id TEXT,
  authority_operation_fingerprint TEXT,
  authority_aggregate_id TEXT,
  lease_expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,ticket_id,item_key),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_retention_cleanup_work_next ON retention_cleanup_work(tenant_id,ticket_id,state,item_key);
CREATE INDEX idx_tickets_retention_cursor ON tickets(tenant_id,julianday(updated_at),id);
CREATE INDEX idx_articles_retention_cursor ON articles(tenant_id,ticket_id,id);
CREATE INDEX idx_attachments_retention_cursor ON attachments(tenant_id,article_id,id);

-- The scheduler never discovers tenants through an unbounded DISTINCT scan of
-- arbitrary automation history. This trusted projection has one row per
-- tenant and is maintained with the rule mutation that changes eligibility.
CREATE TABLE retention_scheduler_tenants (
  tenant_id TEXT PRIMARY KEY,
  active_retention_rules INTEGER NOT NULL CHECK (active_retention_rules >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO retention_scheduler_tenants (tenant_id,active_retention_rules)
SELECT tenant_id,COUNT(*) FROM automation_rules
WHERE is_active=1 AND event_type='scheduled.retention' GROUP BY tenant_id;
CREATE INDEX idx_retention_scheduler_tenants_active ON retention_scheduler_tenants(active_retention_rules,tenant_id);
CREATE TRIGGER retention_scheduler_rule_insert AFTER INSERT ON automation_rules BEGIN
  INSERT INTO retention_scheduler_tenants (tenant_id,active_retention_rules)
  SELECT NEW.tenant_id,COUNT(*) FROM automation_rules WHERE tenant_id=NEW.tenant_id AND is_active=1 AND event_type='scheduled.retention'
  ON CONFLICT(tenant_id) DO UPDATE SET active_retention_rules=excluded.active_retention_rules,updated_at=CURRENT_TIMESTAMP;
END;
CREATE TRIGGER retention_scheduler_rule_update AFTER UPDATE OF tenant_id,is_active,event_type ON automation_rules BEGIN
  INSERT INTO retention_scheduler_tenants (tenant_id,active_retention_rules)
  SELECT OLD.tenant_id,COUNT(*) FROM automation_rules WHERE tenant_id=OLD.tenant_id AND is_active=1 AND event_type='scheduled.retention'
  ON CONFLICT(tenant_id) DO UPDATE SET active_retention_rules=excluded.active_retention_rules,updated_at=CURRENT_TIMESTAMP;
  INSERT INTO retention_scheduler_tenants (tenant_id,active_retention_rules)
  SELECT NEW.tenant_id,COUNT(*) FROM automation_rules WHERE tenant_id=NEW.tenant_id AND is_active=1 AND event_type='scheduled.retention'
  ON CONFLICT(tenant_id) DO UPDATE SET active_retention_rules=excluded.active_retention_rules,updated_at=CURRENT_TIMESTAMP;
END;
CREATE TRIGGER retention_scheduler_rule_delete AFTER DELETE ON automation_rules BEGIN
  INSERT INTO retention_scheduler_tenants (tenant_id,active_retention_rules)
  SELECT OLD.tenant_id,COUNT(*) FROM automation_rules WHERE tenant_id=OLD.tenant_id AND is_active=1 AND event_type='scheduled.retention'
  ON CONFLICT(tenant_id) DO UPDATE SET active_retention_rules=excluded.active_retention_rules,updated_at=CURRENT_TIMESTAMP;
END;

-- A finalization gate exists only inside one trusted repository D1 batch. It
-- permits that batch to remove one already-owned relational row while every
-- ordinary insert/update/delete remains frozen by the original claim trigger.
CREATE TABLE retention_finalization_gates (
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  attempt_token INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,ticket_id),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE
);

DROP TRIGGER retention_freeze_tickets_delete;
DROP TRIGGER retention_freeze_articles_delete;
DROP TRIGGER retention_freeze_attachments_delete;
CREATE TRIGGER retention_freeze_tickets_delete BEFORE DELETE ON tickets
WHEN EXISTS (SELECT 1 FROM ticket_cleanup_claims WHERE tenant_id=OLD.tenant_id AND ticket_id=OLD.id AND mode='retention')
 AND NOT EXISTS (SELECT 1 FROM retention_finalization_gates WHERE tenant_id=OLD.tenant_id AND ticket_id=OLD.id)
BEGIN SELECT RAISE(ABORT, 'Ticket retention in progress'); END;
CREATE TRIGGER retention_freeze_articles_delete BEFORE DELETE ON articles
WHEN EXISTS (SELECT 1 FROM ticket_cleanup_claims WHERE tenant_id=OLD.tenant_id AND ticket_id=OLD.ticket_id AND mode='retention')
 AND NOT EXISTS (SELECT 1 FROM retention_finalization_gates WHERE tenant_id=OLD.tenant_id AND ticket_id=OLD.ticket_id)
BEGIN SELECT RAISE(ABORT, 'Ticket retention in progress'); END;
CREATE TRIGGER retention_freeze_attachments_delete BEFORE DELETE ON attachments
WHEN EXISTS (SELECT 1 FROM ticket_cleanup_claims c JOIN articles a ON a.tenant_id=c.tenant_id AND a.ticket_id=c.ticket_id
  WHERE c.tenant_id=OLD.tenant_id AND a.id=OLD.article_id AND c.mode='retention')
 AND NOT EXISTS (SELECT 1 FROM retention_finalization_gates g JOIN articles a ON a.tenant_id=g.tenant_id AND a.ticket_id=g.ticket_id
  WHERE g.tenant_id=OLD.tenant_id AND a.id=OLD.article_id)
BEGIN SELECT RAISE(ABORT, 'Ticket retention in progress'); END;

-- Discovery must seek to the cursor without scanning earlier eligible rows.
CREATE INDEX idx_retention_rules_cursor ON automation_rules(tenant_id,event_type,is_active,id);
CREATE INDEX idx_retention_progress_rule_cursor ON retention_ticket_progress(tenant_id,rule_id,ticket_id,claim_token);
