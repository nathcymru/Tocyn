-- PRE-MIGRATION VALIDATION
-- This prevents dropping the legacy table if there are unresolvable conflicts
-- or if backfilling will fail. Run this manually or as a pre-flight script.
-- SELECT email_address, COUNT(*) FROM support_emails GROUP BY LOWER(email_address) HAVING COUNT(*) > 1;

CREATE TABLE tenant_support_emails (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    email_address TEXT NOT NULL,
    normalized_email TEXT UNIQUE NOT NULL,
    name TEXT,
    is_default INTEGER DEFAULT 0,
    group_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id)
);

INSERT INTO tenant_support_emails (tenant_id, id, email_address, normalized_email, name, is_default, group_id, created_at, updated_at)
SELECT 'default-tenant', id, email_address, lower(trim(email_address)), name, is_default, group_id, created_at, updated_at FROM support_emails;

DROP TABLE support_emails;
ALTER TABLE tenant_support_emails RENAME TO support_emails;

CREATE TABLE IF NOT EXISTS tenant_config (
    tenant_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, key)
);

-- Seed tenant_config for default-tenant with relevant keys
INSERT OR IGNORE INTO tenant_config (tenant_id, key, value, updated_at)
SELECT 'default-tenant', key, value, updated_at 
FROM config 
WHERE key IN ('RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'TICKET_PREFIX', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY') OR key LIKE 'widget.%';
