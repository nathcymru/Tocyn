-- Stale-reply preconditions read only a ticket's material conversation events.
-- Metadata remains intentionally independent of the operator's reply reread gate.
CREATE INDEX IF NOT EXISTS idx_conversation_events_staff_reply_precondition
  ON conversation_events(tenant_id, ticket_id, kind, sequence);
