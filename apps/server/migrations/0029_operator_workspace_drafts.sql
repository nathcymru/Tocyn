-- Durable operator work is scoped presentation state. It never grants ticket access.
CREATE TABLE operator_drafts (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  generation TEXT NOT NULL CHECK (length(generation) = 36),
  revision INTEGER NOT NULL CHECK (revision > 0),
  mode TEXT NOT NULL CHECK (mode IN ('public','internal')),
  body TEXT NOT NULL CHECK (length(CAST(body AS BLOB)) <= 16000),
  attachments TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(attachments) AND json_type(attachments) IS 'array' AND length(CAST(attachments AS BLOB)) <= 65536
  ),
  base_conversation_revision INTEGER NOT NULL CHECK (base_conversation_revision >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT,
  PRIMARY KEY (tenant_id, user_id, ticket_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, ticket_id) REFERENCES tickets(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_operator_drafts_expiry ON operator_drafts(tenant_id, expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_operator_drafts_ticket ON operator_drafts(tenant_id, ticket_id);

CREATE TABLE operator_workspace_state (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  view_key TEXT NOT NULL CHECK (view_key IN ('all','mine','unassigned','mentions','drafts','snoozed','needs_action','team','custom')),
  sort_key TEXT NOT NULL CHECK (sort_key IN ('updated_desc','updated_asc','created_desc','created_asc','priority_desc','priority_asc')),
  filters TEXT NOT NULL CHECK (
    json_valid(filters) AND json_type(filters) IS 'object' AND length(CAST(filters AS BLOB)) <= 2048
  ),
  list_query TEXT NOT NULL CHECK (length(CAST(list_query AS BLOB)) <= 512),
  list_anchor TEXT NOT NULL CHECK (length(CAST(list_anchor AS BLOB)) <= 512),
  selected_ticket_id TEXT,
  panel TEXT NOT NULL CHECK (panel IN ('conversation','details')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
);
