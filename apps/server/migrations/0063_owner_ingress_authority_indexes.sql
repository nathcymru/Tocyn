-- #64 server-only pre-identity authority lookup. The deployment and owner
-- policy candidates are bounded before JSON parsing or coordinator RPC.
CREATE INDEX IF NOT EXISTS idx_budget_deployment_active_authority
  ON budget_deployment_authority(state, authority_revision, deployment_id);

CREATE INDEX IF NOT EXISTS idx_budget_owner_policy_authority
  ON budget_owner_policies(deployment_id, authority_revision, policy_id, policy_revision);
