-- Support mailbox ownership was rebuilt with core tables in 0014.
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
;
