-- #79: finite, deployment-owned capability ceilings with tenant restrictions.
-- The deployment tables below have no application write route. Changing the
-- ceiling or role grants requires a reviewed owner migration/operational change.

CREATE TABLE IF NOT EXISTS deployment_capability_ceiling (
    capability TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deployment_role_capability_grants (
    role TEXT NOT NULL CHECK (role IN ('admin', 'agent', 'customer')),
    capability TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role, capability),
    FOREIGN KEY (capability) REFERENCES deployment_capability_ceiling(capability)
);

-- Tenant policy is deliberately a further restriction of a deployment role
-- grant. Its version is fenced at mutation time; it is not authority for the
-- owner ceiling or role-grant tables above.
CREATE TABLE IF NOT EXISTS tenant_role_capability_policies (
    tenant_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'agent', 'customer')),
    capability TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, role, capability),
    FOREIGN KEY (capability) REFERENCES deployment_capability_ceiling(capability)
);

CREATE TABLE IF NOT EXISTS tenant_capability_policy_versions (
    tenant_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'agent', 'customer')),
    revision INTEGER NOT NULL DEFAULT 1,
    change_token TEXT,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, role)
);

-- Group constraints are deny-only at runtime. They preserve existing groups as
-- resource scope and cannot create a capability absent from owner/role policy.
CREATE TABLE IF NOT EXISTS tenant_group_capability_constraints (
    tenant_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, group_id, capability),
    FOREIGN KEY (capability) REFERENCES deployment_capability_ceiling(capability)
);

INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('settings.general.manage', 1);
INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('users.manage', 1);
INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('groups.manage', 1);
INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('ticket-fields.manage', 1);
INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('filters.manage', 1);
INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('automations.manage', 1);
INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('api-keys.manage', 1);
INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('usage.read', 1);
INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('channels.email.manage', 1);
INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('channels.widget.manage', 1);
INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('permissions.manage', 1);
INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('tools.reference.read', 1);
INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('tools.reference.low-risk-write', 1);
INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('tools.reference.privileged-write', 1);
INSERT OR IGNORE INTO deployment_capability_ceiling (capability, enabled) VALUES ('tools.reference.destructive', 1);

-- Existing admin behaviour becomes an explicit deployment-owner role grant,
-- rather than an unconditional middleware bypass. Agents retain only the
-- previously configurable settings capabilities; tool grants are intentionally
-- absent until a reviewed owner migration adds them.
INSERT OR IGNORE INTO deployment_role_capability_grants (role, capability, enabled)
SELECT 'admin', capability, 1 FROM deployment_capability_ceiling;

INSERT OR IGNORE INTO deployment_role_capability_grants (role, capability, enabled) VALUES ('agent', 'settings.general.manage', 1);
INSERT OR IGNORE INTO deployment_role_capability_grants (role, capability, enabled) VALUES ('agent', 'users.manage', 1);
INSERT OR IGNORE INTO deployment_role_capability_grants (role, capability, enabled) VALUES ('agent', 'groups.manage', 1);
INSERT OR IGNORE INTO deployment_role_capability_grants (role, capability, enabled) VALUES ('agent', 'ticket-fields.manage', 1);
INSERT OR IGNORE INTO deployment_role_capability_grants (role, capability, enabled) VALUES ('agent', 'filters.manage', 1);
INSERT OR IGNORE INTO deployment_role_capability_grants (role, capability, enabled) VALUES ('agent', 'automations.manage', 1);
INSERT OR IGNORE INTO deployment_role_capability_grants (role, capability, enabled) VALUES ('agent', 'api-keys.manage', 1);
INSERT OR IGNORE INTO deployment_role_capability_grants (role, capability, enabled) VALUES ('agent', 'usage.read', 1);
INSERT OR IGNORE INTO deployment_role_capability_grants (role, capability, enabled) VALUES ('agent', 'channels.email.manage', 1);
INSERT OR IGNORE INTO deployment_role_capability_grants (role, capability, enabled) VALUES ('agent', 'channels.widget.manage', 1);

-- Migrate the old tenant-local boolean map into a restrictive agent policy.
-- A malformed or absent legacy value stays denied. This keeps existing tenant
-- behaviour while making all later authorization live and versioned.
INSERT OR IGNORE INTO tenant_capability_policy_versions (tenant_id, role)
SELECT tenant_id, 'agent' FROM users GROUP BY tenant_id;

INSERT OR IGNORE INTO tenant_role_capability_policies (tenant_id, role, capability, enabled)
SELECT users.tenant_id, 'agent', 'settings.general.manage', CASE WHEN json_valid(config.value) = 1 AND json_extract(config.value, '$.general') = 1 THEN 1 ELSE 0 END FROM users LEFT JOIN tenant_config config ON config.tenant_id = users.tenant_id AND config.key = 'agent_settings_permissions' GROUP BY users.tenant_id;
INSERT OR IGNORE INTO tenant_role_capability_policies (tenant_id, role, capability, enabled)
SELECT users.tenant_id, 'agent', 'users.manage', CASE WHEN json_valid(config.value) = 1 AND json_extract(config.value, '$.users') = 1 THEN 1 ELSE 0 END FROM users LEFT JOIN tenant_config config ON config.tenant_id = users.tenant_id AND config.key = 'agent_settings_permissions' GROUP BY users.tenant_id;
INSERT OR IGNORE INTO tenant_role_capability_policies (tenant_id, role, capability, enabled)
SELECT users.tenant_id, 'agent', 'groups.manage', CASE WHEN json_valid(config.value) = 1 AND json_extract(config.value, '$.groups') = 1 THEN 1 ELSE 0 END FROM users LEFT JOIN tenant_config config ON config.tenant_id = users.tenant_id AND config.key = 'agent_settings_permissions' GROUP BY users.tenant_id;
INSERT OR IGNORE INTO tenant_role_capability_policies (tenant_id, role, capability, enabled)
SELECT users.tenant_id, 'agent', 'ticket-fields.manage', CASE WHEN json_valid(config.value) = 1 AND json_extract(config.value, '$.ticket_fields') = 1 THEN 1 ELSE 0 END FROM users LEFT JOIN tenant_config config ON config.tenant_id = users.tenant_id AND config.key = 'agent_settings_permissions' GROUP BY users.tenant_id;
INSERT OR IGNORE INTO tenant_role_capability_policies (tenant_id, role, capability, enabled)
SELECT users.tenant_id, 'agent', 'filters.manage', CASE WHEN json_valid(config.value) = 1 AND json_extract(config.value, '$.filters') = 1 THEN 1 ELSE 0 END FROM users LEFT JOIN tenant_config config ON config.tenant_id = users.tenant_id AND config.key = 'agent_settings_permissions' GROUP BY users.tenant_id;
INSERT OR IGNORE INTO tenant_role_capability_policies (tenant_id, role, capability, enabled)
SELECT users.tenant_id, 'agent', 'automations.manage', CASE WHEN json_valid(config.value) = 1 AND json_extract(config.value, '$.automations') = 1 THEN 1 ELSE 0 END FROM users LEFT JOIN tenant_config config ON config.tenant_id = users.tenant_id AND config.key = 'agent_settings_permissions' GROUP BY users.tenant_id;
INSERT OR IGNORE INTO tenant_role_capability_policies (tenant_id, role, capability, enabled)
SELECT users.tenant_id, 'agent', 'api-keys.manage', CASE WHEN json_valid(config.value) = 1 AND json_extract(config.value, '$.api_keys') = 1 THEN 1 ELSE 0 END FROM users LEFT JOIN tenant_config config ON config.tenant_id = users.tenant_id AND config.key = 'agent_settings_permissions' GROUP BY users.tenant_id;
INSERT OR IGNORE INTO tenant_role_capability_policies (tenant_id, role, capability, enabled)
SELECT users.tenant_id, 'agent', 'usage.read', CASE WHEN json_valid(config.value) = 1 AND json_extract(config.value, '$.usage') = 1 THEN 1 ELSE 0 END FROM users LEFT JOIN tenant_config config ON config.tenant_id = users.tenant_id AND config.key = 'agent_settings_permissions' GROUP BY users.tenant_id;
INSERT OR IGNORE INTO tenant_role_capability_policies (tenant_id, role, capability, enabled)
SELECT users.tenant_id, 'agent', 'channels.email.manage', CASE WHEN json_valid(config.value) = 1 AND json_extract(config.value, '$.channels_email') = 1 THEN 1 ELSE 0 END FROM users LEFT JOIN tenant_config config ON config.tenant_id = users.tenant_id AND config.key = 'agent_settings_permissions' GROUP BY users.tenant_id;
INSERT OR IGNORE INTO tenant_role_capability_policies (tenant_id, role, capability, enabled)
SELECT users.tenant_id, 'agent', 'channels.widget.manage', CASE WHEN json_valid(config.value) = 1 AND json_extract(config.value, '$.channels_widget') = 1 THEN 1 ELSE 0 END FROM users LEFT JOIN tenant_config config ON config.tenant_id = users.tenant_id AND config.key = 'agent_settings_permissions' GROUP BY users.tenant_id;

CREATE INDEX IF NOT EXISTS idx_tenant_role_capability_policy_lookup
  ON tenant_role_capability_policies (tenant_id, role, capability);
CREATE INDEX IF NOT EXISTS idx_group_capability_constraint_lookup
  ON tenant_group_capability_constraints (tenant_id, group_id, capability);
