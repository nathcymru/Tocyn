-- Missing or ambiguous legacy user ownership produces NULL and aborts before dropping source data.
-- Add tenant_id to customer_auth_tokens to enforce (tenant_id, user_id) composite isolation
PRAGMA defer_foreign_keys = on;

CREATE TABLE new_customer_auth_tokens (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('magic_link', 'otp')),
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at DATETIME,
    PRIMARY KEY (id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE
);

INSERT INTO new_customer_auth_tokens (tenant_id, id, user_id, token_hash, type, expires_at, created_at, used_at)
SELECT (SELECT MIN(u.tenant_id) FROM users u WHERE u.id = t.user_id HAVING COUNT(*) = 1),
       t.id, t.user_id, t.token_hash, t.type, t.expires_at, t.created_at, t.used_at
FROM customer_auth_tokens t;

DROP TABLE customer_auth_tokens;
ALTER TABLE new_customer_auth_tokens RENAME TO customer_auth_tokens;

CREATE INDEX idx_customer_auth_tokens_token_hash ON customer_auth_tokens(token_hash);
CREATE INDEX idx_customer_auth_tokens_user ON customer_auth_tokens(tenant_id, user_id);

PRAGMA foreign_key_check;
