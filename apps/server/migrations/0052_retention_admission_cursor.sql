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
  rule_id TEXT,
  attachment_article_id TEXT,
  attachment_id TEXT,
  body_article_id TEXT,
  legacy_article_id TEXT,
  legacy_offset INTEGER NOT NULL DEFAULT 0 CHECK (legacy_offset >= 0),
  attachments_done INTEGER NOT NULL DEFAULT 0 CHECK (attachments_done IN (0,1)),
  bodies_done INTEGER NOT NULL DEFAULT 0 CHECK (bodies_done IN (0,1)),
  legacy_done INTEGER NOT NULL DEFAULT 0 CHECK (legacy_done IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,ticket_id),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE retention_cleanup_work (
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('attachment','article_body','legacy_vector','versioned_vector')),
  state TEXT NOT NULL CHECK (state IN ('pending','claimed','uncertain','complete')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 1000000),
  authority_revision INTEGER,
  recovery_reservation TEXT,
  lease_expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,ticket_id,item_key),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_retention_cleanup_work_next ON retention_cleanup_work(tenant_id,ticket_id,state,item_key);
CREATE INDEX idx_tickets_retention_cursor ON tickets(tenant_id,julianday(updated_at),id);
CREATE INDEX idx_articles_retention_cursor ON articles(tenant_id,ticket_id,id);
CREATE INDEX idx_attachments_retention_cursor ON attachments(tenant_id,article_id,id);
