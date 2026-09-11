-- D1 `meta.size_after` is retained only as post-commit, database-scoped
-- evidence on an existing admitted operation. It is not a tenant allocation,
-- a physical delta, or an advance admission oracle.
ALTER TABLE budget_grant_operations ADD COLUMN d1_database_size_after INTEGER
  CHECK (d1_database_size_after IS NULL OR d1_database_size_after >= 0);
ALTER TABLE budget_grant_operations ADD COLUMN d1_database_size_observed_at INTEGER
  CHECK (d1_database_size_observed_at IS NULL OR d1_database_size_observed_at >= 0);
