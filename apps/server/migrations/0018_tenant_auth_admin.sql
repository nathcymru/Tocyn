-- Migration 0018: Tenantize ticket_filters, create canonical email index and widget public key index
-- Pre-flight checks: Ensure no canonical lower(trim(email)) collisions exist.

PRAGMA defer_foreign_keys = on;

----------------------------------------------------------------------
-- 1. Canonical Login Unique Index
----------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_email ON users(lower(trim(email)));

----------------------------------------------------------------------
-- 2. Widget Public Key Global Uniqueness Index
----------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_widget_public_key ON tenant_config(value) WHERE key = 'widget.public_key';

----------------------------------------------------------------------
-- 3. ticket_filters: composite PK (tenant_id, id), UNIQUE(tenant_id, name)
----------------------------------------------------------------------
CREATE TABLE new_ticket_filters (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    conditions TEXT,
    is_system BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME,
    updated_at DATETIME,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name)
);

INSERT INTO new_ticket_filters (tenant_id, id, name, conditions, is_system, created_at, updated_at)
SELECT 'default-tenant', id, name, conditions, is_system, created_at, updated_at
FROM ticket_filters;

DROP TABLE ticket_filters;
ALTER TABLE new_ticket_filters RENAME TO ticket_filters;

----------------------------------------------------------------------
-- Integrity check
----------------------------------------------------------------------
PRAGMA foreign_key_check;
