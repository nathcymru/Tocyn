-- #317: allow three independent, whole-queue priority views. Existing saved
-- workspace rows retain their sort and every other preference unchanged.
CREATE TABLE operator_workspace_state_priority (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  view_key TEXT NOT NULL CHECK (view_key IN ('all','mine','unassigned','mentions','drafts','snoozed','needs_action','team','custom')),
  sort_key TEXT NOT NULL CHECK (sort_key IN ('updated_desc','updated_asc','created_desc','created_asc','priority_desc','priority_asc','sla_priority','priority_focus','priority_criticality','priority_commitment')),
  filters TEXT NOT NULL CHECK (
    json_valid(filters) AND json_type(filters) IS 'object' AND length(CAST(filters AS BLOB)) <= 2048
  ),
  list_query TEXT NOT NULL CHECK (length(CAST(list_query AS BLOB)) <= 512),
  list_anchor TEXT NOT NULL CHECK (length(CAST(list_anchor AS BLOB)) <= 512),
  selected_ticket_id TEXT,
  panel TEXT NOT NULL CHECK (panel IN ('conversation','details')),
  splitter_ratio INTEGER NOT NULL DEFAULT 32 CHECK (splitter_ratio BETWEEN 24 AND 50),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
);

INSERT INTO operator_workspace_state_priority
  (tenant_id,user_id,revision,view_key,sort_key,filters,list_query,list_anchor,selected_ticket_id,panel,splitter_ratio,created_at,updated_at)
SELECT tenant_id,user_id,revision,view_key,sort_key,filters,list_query,list_anchor,selected_ticket_id,panel,splitter_ratio,created_at,updated_at
FROM operator_workspace_state;
DROP TABLE operator_workspace_state;
ALTER TABLE operator_workspace_state_priority RENAME TO operator_workspace_state;
