CREATE INDEX idx_tickets_tenant_customer_created 
ON tickets(tenant_id, customer_email, created_at DESC);
