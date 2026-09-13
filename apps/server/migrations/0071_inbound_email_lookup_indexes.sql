-- Exact inbound threading and the existing per-sender burst check must not scan
-- an unbounded tenant history after a fixed admission envelope is reserved.
CREATE INDEX idx_tickets_inbound_subject ON tickets(tenant_id,subject,id);
CREATE INDEX idx_articles_inbound_message ON articles(tenant_id,raw_email_id,ticket_id);
CREATE INDEX idx_articles_inbound_customer_time ON articles(tenant_id,sender_id,sender_type,unixepoch(created_at));
