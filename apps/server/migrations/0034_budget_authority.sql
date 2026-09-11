-- #64 durable budget authority. These rows are deployment-owned configuration;
-- no tenant-facing repository or handler writes them in this slice.
CREATE TABLE IF NOT EXISTS budget_deployment_authority (
  deployment_id TEXT PRIMARY KEY,
  authority_revision INTEGER NOT NULL CHECK (authority_revision > 0),
  state TEXT NOT NULL CHECK (state IN ('active', 'revoked')),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_owner_policies (
  deployment_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_revision INTEGER NOT NULL CHECK (policy_revision > 0),
  authority_revision INTEGER NOT NULL CHECK (authority_revision > 0),
  coordinator_id TEXT NOT NULL,
  max_reservations INTEGER NOT NULL CHECK (max_reservations BETWEEN 1 AND 4096),
  authority_max_age_ms INTEGER NOT NULL CHECK (authority_max_age_ms > 0),
  policy_json TEXT NOT NULL,
  PRIMARY KEY (deployment_id, policy_id, policy_revision)
);

CREATE TABLE IF NOT EXISTS budget_tenant_allocations (
  deployment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_revision INTEGER NOT NULL CHECK (policy_revision > 0),
  authority_revision INTEGER NOT NULL CHECK (authority_revision > 0),
  reservation_namespace TEXT NOT NULL,
  restriction_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'revoked')),
  PRIMARY KEY (deployment_id, tenant_id),
  UNIQUE (tenant_id),
  UNIQUE (reservation_namespace),
  FOREIGN KEY (deployment_id, policy_id, policy_revision)
    REFERENCES budget_owner_policies(deployment_id, policy_id, policy_revision)
);

CREATE INDEX IF NOT EXISTS idx_budget_tenant_authority
  ON budget_tenant_allocations(deployment_id, policy_id, policy_revision, authority_revision, state);
