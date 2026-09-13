-- #137 assignment admission limits; existing work is never silently unassigned.
CREATE TABLE operator_capacity (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  availability TEXT NOT NULL CHECK(availability IN ('available','unavailable')),
  assignment_ceiling INTEGER NOT NULL CHECK(assignment_ceiling BETWEEN 0 AND 1000),
  updated_at TEXT NOT NULL,
  -- Historical actor identity; current author authority is enforced in the write batch.
  updated_by TEXT NOT NULL,
  PRIMARY KEY(tenant_id,user_id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_tickets_capacity_load ON tickets(tenant_id,assigned_to,status,id);
