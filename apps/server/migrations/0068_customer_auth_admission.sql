-- Authentication effects need a fail-closed assertion that is independent of
-- canonical ticket mutations.  Unlike budget_mutation_assertion, zero is a
-- valid outcome here: a stale admission must leave the guarded write absent.
CREATE TABLE IF NOT EXISTS customer_auth_budget_assertions (
  tenant_id TEXT PRIMARY KEY,
  accepted INTEGER NOT NULL CHECK (accepted IN (0,1))
);

-- The current OTP pointer replaces the former unbounded invalidation update.
-- Existing expired/challenged rows stay available for audit; only the newest
-- active challenge is eligible for verification.
CREATE TABLE IF NOT EXISTS customer_current_otp_challenges (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_current_otp_token
  ON customer_current_otp_challenges(tenant_id, token_id);
INSERT INTO customer_current_otp_challenges(tenant_id,user_id,token_id)
SELECT newer.tenant_id,newer.user_id,newer.id FROM customer_auth_tokens newer
WHERE newer.type='otp' AND newer.used_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM customer_auth_tokens later
    WHERE later.tenant_id=newer.tenant_id AND later.user_id=newer.user_id AND later.type='otp' AND later.used_at IS NULL
      AND (later.created_at>newer.created_at OR (later.created_at=newer.created_at AND later.id>newer.id)));
