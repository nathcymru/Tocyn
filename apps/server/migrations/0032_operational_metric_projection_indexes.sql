-- Tenant candidate CTEs must be bounded before actor filtering or event joins.
-- Both reads are covered in candidate order so hidden sparse groups cannot cause a
-- full tenant scan or an unbounded event sort.
CREATE INDEX IF NOT EXISTS idx_tickets_operational_metric_projection
  ON tickets(tenant_id, id, status, assigned_to, group_id);
CREATE INDEX IF NOT EXISTS idx_conversation_events_operational_metric_projection
  ON conversation_events(tenant_id, ticket_id, sequence, recorded_at);
