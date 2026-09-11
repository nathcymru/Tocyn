-- Existing closure evidence has no certified expiry. NULL means retain it;
-- never infer a cleanup horizon from a historic timestamp or current policy.
ALTER TABLE budget_grant_closures ADD COLUMN expires_at INTEGER;
CREATE INDEX budget_grant_closures_expiry_idx
  ON budget_grant_closures (tenant_id,expires_at,reservation_id,holder_id);
