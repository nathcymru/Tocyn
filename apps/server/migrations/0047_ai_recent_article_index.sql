-- Bounded staff AI retrieval: tenant/ticket/newest-five in index order.
CREATE INDEX IF NOT EXISTS idx_articles_tenant_ticket_recent
  ON articles(tenant_id, ticket_id, created_at DESC, id DESC);
