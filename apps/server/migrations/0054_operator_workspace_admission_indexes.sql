-- Actor-qualified bounded cleanup and indicator pages. Existing expiry/ticket
-- indexes cannot seek one operator's expired prefix without scanning peers.
CREATE INDEX IF NOT EXISTS idx_operator_drafts_actor_expiry
  ON operator_drafts(tenant_id,user_id,expires_at,updated_at);
CREATE INDEX IF NOT EXISTS idx_operator_drafts_actor_ticket
  ON operator_drafts(tenant_id,user_id,ticket_id);
