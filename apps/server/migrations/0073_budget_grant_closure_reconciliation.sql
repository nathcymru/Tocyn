-- Expiry alone is not confirmation that central accounting accepted closure.
-- Existing rows remain unacknowledged and retain their exact operation journal.
ALTER TABLE budget_grant_closures ADD COLUMN reconciled_at INTEGER;
CREATE INDEX budget_grant_closures_reconciled_expiry_idx
  ON budget_grant_closures (tenant_id,expires_at,reservation_id,holder_id)
  WHERE reconciled_at IS NOT NULL;
