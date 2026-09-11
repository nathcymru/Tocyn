-- Retry-safe admission receipts for bounded dashboard support-state and SLA writes.
CREATE TABLE support_sla_mutation_receipts (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('dashboard.sla.policy.set','dashboard.support-state.create','dashboard.support-state.update','dashboard.support-state.deactivate','dashboard.ticket.sla.initialize','dashboard.ticket.support-state.transition')),
  key_hash TEXT NOT NULL CHECK (length(key_hash)=64),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash)=64),
  result_ticket_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch()+86400),
  lifecycle TEXT NOT NULL DEFAULT 'completed' CHECK (lifecycle IN ('completed','gone')),
  response_status INTEGER NOT NULL CHECK (response_status IN (200,201)),
  response_snapshot TEXT,
  PRIMARY KEY (tenant_id,principal_id,operation,key_hash),
  CHECK (expires_at>created_at),
  CHECK ((lifecycle='gone' AND response_snapshot IS NULL) OR (lifecycle='completed' AND response_snapshot IS NOT NULL
    AND length(CAST(response_snapshot AS BLOB))<=262144 AND json_valid(response_snapshot)))
);
CREATE INDEX idx_support_sla_mutation_receipts_expiry ON support_sla_mutation_receipts(tenant_id,principal_id,expires_at);
CREATE INDEX idx_support_sla_mutation_receipts_ticket ON support_sla_mutation_receipts(tenant_id,result_ticket_id);
CREATE TRIGGER redact_support_sla_mutation_receipts_ticket AFTER DELETE ON tickets BEGIN
  UPDATE support_sla_mutation_receipts SET lifecycle='gone',response_snapshot=NULL
    WHERE tenant_id=OLD.tenant_id AND result_ticket_id=OLD.id;
END;

-- Bounded support-state remaps select at most 101 source rows and update only
-- the token-marked candidate tickets; both access paths remain tenant-qualified.
CREATE INDEX idx_ticket_support_state_definition_ticket ON ticket_support_state(tenant_id,definition_id,ticket_id);
CREATE INDEX idx_ticket_support_state_transition_ticket ON ticket_support_state(tenant_id,transition_token,ticket_id);
