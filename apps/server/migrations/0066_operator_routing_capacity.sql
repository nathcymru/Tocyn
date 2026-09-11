-- #137: server-authoritative availability and a hard current-work ceiling.
-- `tickets.assigned_to` remains the sole responsible-handler record; this is
-- only the tenant-scoped policy used when that record changes.
CREATE TABLE operator_routing_profiles (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1)),
  assignment_capacity INTEGER CHECK (assignment_capacity IS NULL OR (assignment_capacity >= 0 AND assignment_capacity <= 500)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,user_id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);

CREATE INDEX idx_operator_routing_profiles_tenant_available
  ON operator_routing_profiles(tenant_id,is_available,user_id);
