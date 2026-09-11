-- #137: tenant-local queue history used only to break equal current-work ties.
-- It records successful automatic selections; tickets.assigned_to remains the
-- canonical responsible-handler field and conversation_events remains the audit.
CREATE TABLE operator_routing_fairness (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_selection_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_selection_sequence >= 0),
  last_selected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,user_id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);

CREATE INDEX idx_operator_routing_fairness_tenant_selected
  ON operator_routing_fairness(tenant_id,last_selection_sequence,user_id);
