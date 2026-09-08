-- Existing unbound OTPs cannot be safely upgraded to the challenge-bound contract.
ALTER TABLE customer_auth_tokens ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0);
UPDATE customer_auth_tokens SET used_at = CURRENT_TIMESTAMP WHERE type = 'otp' AND used_at IS NULL;
