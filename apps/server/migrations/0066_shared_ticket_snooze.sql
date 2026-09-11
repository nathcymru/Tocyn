-- #130: shared, tenant-scoped snooze facts live with the canonical support state.
ALTER TABLE ticket_support_state ADD COLUMN snoozed_until TEXT
  CHECK (snoozed_until IS NULL OR length(CAST(snoozed_until AS BLOB)) = 24);
ALTER TABLE ticket_support_state ADD COLUMN resurface_reason TEXT
  CHECK (resurface_reason IS NULL OR resurface_reason IN ('manual','due','customer_reply'));
CREATE INDEX idx_ticket_support_state_snooze
  ON ticket_support_state(tenant_id, snoozed_until, ticket_id);
