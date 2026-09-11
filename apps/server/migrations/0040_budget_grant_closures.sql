-- #64 API isolate grant recovery. Operation links are committed with the
-- canonical mutation; a closure is immutable terminal evidence for one whole
-- prepaid reservation, never an individual-operation receipt.
CREATE TABLE budget_grant_operations (
  tenant_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  operation_fingerprint TEXT NOT NULL,
  operation_envelope_json TEXT NOT NULL CHECK (json_valid(operation_envelope_json)),
  committed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id,reservation_id,holder_id,operation_id),
  FOREIGN KEY (tenant_id) REFERENCES budget_tenant_allocations(tenant_id) ON DELETE RESTRICT
);

CREATE TABLE budget_grant_closures (
  tenant_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  terminal_evidence_id TEXT NOT NULL,
  operation_set_fingerprint TEXT NOT NULL,
  operation_count INTEGER NOT NULL CHECK (operation_count BETWEEN 1 AND 8),
  measured_json TEXT NOT NULL CHECK (json_valid(measured_json)),
  uncertain_json TEXT NOT NULL CHECK (json_valid(uncertain_json)),
  expires_at INTEGER NOT NULL,
  closed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id,reservation_id,holder_id),
  UNIQUE (tenant_id,terminal_evidence_id),
  FOREIGN KEY (tenant_id) REFERENCES budget_tenant_allocations(tenant_id) ON DELETE RESTRICT
);

CREATE INDEX budget_grant_closures_expiry_idx
  ON budget_grant_closures (tenant_id,expires_at,reservation_id,holder_id);
