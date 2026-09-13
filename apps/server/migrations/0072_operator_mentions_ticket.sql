-- #130: existence-only per-ticket mention membership, independent of activity history size.
-- Reading a mention does not complete work; explicit dismissal removes this membership.
CREATE INDEX idx_operator_activities_open_mention_ticket
  ON operator_activities(tenant_id,recipient_user_id,ticket_id)
  WHERE kind='mention' AND dismissed_at IS NULL;
