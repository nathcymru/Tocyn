-- Migration 0017: Tenantize api_keys, automation_rules, ticket_fields, groups, and user_groups
-- Assumption: The pre-cutover database is provably single-tenant.
-- All legacy rows are explicitly backfilled with 'default-tenant'.
-- No DEFAULT 'default-tenant' on any schema column.

PRAGMA defer_foreign_keys = on;

----------------------------------------------------------------------
-- 1. api_keys: PK (tenant_id, id), UNIQUE(key_hash) globally, permissions column
----------------------------------------------------------------------
CREATE TABLE new_api_keys (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    permissions TEXT NOT NULL,
    is_active BOOLEAN NOT NULL,
    created_at DATETIME,
    last_used_at DATETIME,
    PRIMARY KEY (tenant_id, id)
);

INSERT INTO new_api_keys (tenant_id, id, name, key_hash, prefix, permissions, is_active, created_at, last_used_at)
SELECT 'default-tenant', id, name, key_hash, prefix, 'tickets:read,tickets:write', is_active, created_at, last_used_at
FROM api_keys;

DROP TABLE api_keys;
ALTER TABLE new_api_keys RENAME TO api_keys;

----------------------------------------------------------------------
-- 2. automation_rules: PK (tenant_id, id), UNIQUE(tenant_id, name)
----------------------------------------------------------------------
CREATE TABLE new_automation_rules (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    event_type TEXT NOT NULL,
    conditions TEXT,
    action_type TEXT NOT NULL,
    action_config TEXT,
    is_active BOOLEAN NOT NULL,
    created_at DATETIME,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name)
);

INSERT INTO new_automation_rules (tenant_id, id, name, event_type, conditions, action_type, action_config, is_active, created_at)
SELECT 'default-tenant', id, name, event_type, conditions, action_type, action_config, is_active, created_at
FROM automation_rules;

DROP TABLE automation_rules;
ALTER TABLE new_automation_rules RENAME TO automation_rules;

----------------------------------------------------------------------
-- 3. ticket_fields: PK (tenant_id, id), UNIQUE(tenant_id, name)
----------------------------------------------------------------------
CREATE TABLE new_ticket_fields (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    label TEXT NOT NULL,
    field_type TEXT NOT NULL,
    options TEXT,
    is_active INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name)
);

INSERT INTO new_ticket_fields (tenant_id, id, name, label, field_type, options, is_active)
SELECT 'default-tenant', id, name, label, field_type, options, is_active
FROM ticket_fields;

DROP TABLE ticket_fields;
ALTER TABLE new_ticket_fields RENAME TO ticket_fields;

----------------------------------------------------------------------
-- 4. groups: PK (tenant_id, id), UNIQUE(tenant_id, name)
----------------------------------------------------------------------
CREATE TABLE new_groups (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name)
);

INSERT INTO new_groups (tenant_id, id, name, description, created_at)
SELECT 'default-tenant', id, name, description, created_at
FROM groups;

DROP TABLE groups;
ALTER TABLE new_groups RENAME TO groups;

----------------------------------------------------------------------
-- 5. user_groups: add tenant_id, composite FKs to users and groups
----------------------------------------------------------------------
CREATE TABLE new_user_groups (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id, group_id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, group_id) REFERENCES groups(tenant_id, id)
);

INSERT INTO new_user_groups (tenant_id, user_id, group_id)
SELECT 'default-tenant', user_id, group_id
FROM user_groups;

DROP TABLE user_groups;
ALTER TABLE new_user_groups RENAME TO user_groups;

----------------------------------------------------------------------
-- Indexes
----------------------------------------------------------------------
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_automation_rules_tenant_event ON automation_rules(tenant_id, event_type, is_active);

----------------------------------------------------------------------
-- Integrity check
----------------------------------------------------------------------
PRAGMA foreign_key_check;
