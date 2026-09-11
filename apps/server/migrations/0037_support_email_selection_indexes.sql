-- 0035 belongs to article/draft format; 0036 is reserved for staff mutation receipts.
-- Bounded indexed sender selection without imposing a tenant channel-count limit.
CREATE INDEX idx_support_emails_tenant_group_created
  ON support_emails(tenant_id, group_id, created_at, id);
CREATE INDEX idx_support_emails_tenant_default_created
  ON support_emails(tenant_id, is_default, created_at, id);
