-- Local operator authority is deployment-scoped, deliberately separate from tenant data.
-- New runs preserve old counters. No application route may initialize or amend policy.
CREATE TABLE local_beta_runs (
  run_id TEXT PRIMARY KEY CHECK(length(run_id) BETWEEN 1 AND 100),
  ticket_limit INTEGER NOT NULL CHECK(ticket_limit BETWEEN 1 AND 100),
  mutation_limit INTEGER NOT NULL CHECK(mutation_limit BETWEEN 2 AND 1000),
  recovery_reserve INTEGER NOT NULL CHECK(recovery_reserve >= 1 AND recovery_reserve < mutation_limit),
  upload_limit INTEGER NOT NULL CHECK(upload_limit BETWEEN 1 AND 100),
  tickets INTEGER NOT NULL DEFAULT 0 CHECK(tickets BETWEEN 0 AND ticket_limit),
  mutations INTEGER NOT NULL DEFAULT 0 CHECK(mutations BETWEEN 0 AND mutation_limit),
  upload_attempts INTEGER NOT NULL DEFAULT 0 CHECK(upload_attempts BETWEEN 0 AND upload_limit),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE local_beta_policy (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  run_id TEXT NOT NULL UNIQUE REFERENCES local_beta_runs(run_id),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  state TEXT NOT NULL CHECK(state IN ('running','intake_stopped','writes_stopped'))
);
CREATE TABLE local_beta_tenants (
  run_id TEXT NOT NULL REFERENCES local_beta_runs(run_id),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) BETWEEN 1 AND 100),
  PRIMARY KEY(run_id, tenant_id)
);
CREATE TABLE local_beta_invitations (
  run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  principal_kind TEXT NOT NULL CHECK(principal_kind IN ('customer','staff','api-key')),
  principal_id TEXT NOT NULL CHECK(length(principal_id) BETWEEN 1 AND 100),
  PRIMARY KEY(run_id, tenant_id, principal_kind, principal_id),
  FOREIGN KEY(run_id, tenant_id) REFERENCES local_beta_tenants(run_id, tenant_id)
);
-- A failed CHECK aborts the entire D1 batch, on both insert and conflict-update paths.
CREATE TABLE local_beta_assertion (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  accepted INTEGER NOT NULL CHECK(accepted = 1)
);
CREATE TABLE local_beta_operator_receipts (
  revision INTEGER PRIMARY KEY,
  action TEXT NOT NULL CHECK(action IN ('initialize','new-run','stop-intake','stop-writes','resume')),
  run_id TEXT NOT NULL REFERENCES local_beta_runs(run_id),
  prior_run_id TEXT REFERENCES local_beta_runs(run_id),
  prior_tickets INTEGER NOT NULL,
  prior_mutations INTEGER NOT NULL,
  prior_upload_attempts INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
