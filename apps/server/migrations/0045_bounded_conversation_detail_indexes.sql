-- Detail pages select only current public article metadata, then look up a
-- finite attachment/reference set. These indexes prevent hidden prefixes and
-- attachment ordering from expanding the read or write envelope.
CREATE INDEX IF NOT EXISTS idx_articles_tenant_ticket_visibility_created_id
  ON articles(tenant_id,ticket_id,is_internal,created_at,id);
CREATE INDEX IF NOT EXISTS idx_attachments_tenant_article_created_id
  ON attachments(tenant_id,article_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_conversation_events_ticket_kind_visibility_sequence
  ON conversation_events(tenant_id,ticket_id,kind,visibility,sequence);
CREATE INDEX IF NOT EXISTS idx_conversation_events_ticket_article_kind
  ON conversation_events(tenant_id,ticket_id,article_id,kind);
