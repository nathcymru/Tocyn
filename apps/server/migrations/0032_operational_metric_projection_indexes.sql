-- The bounded current-work projection walks this tenant/id index and joins events
-- through the existing (tenant_id,ticket_id,sequence) unique key.
CREATE INDEX IF NOT EXISTS idx_tickets_operational_metric_projection
  ON tickets(tenant_id, id, status, assigned_to, group_id);
