-- Maintained API-key population expands complete-list reservations without
-- imposing a product cap. Creation receipts intentionally retain metadata
-- only: plaintext credentials and credential hashes never enter this table.
CREATE TABLE api_key_admin_population (
  tenant_id TEXT PRIMARY KEY,
  key_count INTEGER NOT NULL DEFAULT 0 CHECK (key_count >= 0)
);

INSERT INTO api_key_admin_population(tenant_id,key_count)
SELECT tenant_id,COUNT(*) FROM api_keys GROUP BY tenant_id;

CREATE TRIGGER api_key_admin_population_insert AFTER INSERT ON api_keys BEGIN
  INSERT INTO api_key_admin_population(tenant_id,key_count) VALUES (NEW.tenant_id,1)
  ON CONFLICT(tenant_id) DO UPDATE SET key_count=key_count+1;
END;

CREATE TRIGGER api_key_admin_population_delete AFTER DELETE ON api_keys BEGIN
  UPDATE api_key_admin_population SET key_count=key_count-1 WHERE tenant_id=OLD.tenant_id;
END;

CREATE TRIGGER api_key_admin_population_move AFTER UPDATE OF tenant_id ON api_keys
WHEN OLD.tenant_id<>NEW.tenant_id BEGIN
  UPDATE api_key_admin_population SET key_count=key_count-1 WHERE tenant_id=OLD.tenant_id;
  INSERT INTO api_key_admin_population(tenant_id,key_count) VALUES (NEW.tenant_id,1)
  ON CONFLICT(tenant_id) DO UPDATE SET key_count=key_count+1;
END;

CREATE TABLE api_key_creation_receipts (
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  api_key_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,actor_id,idempotency_hash)
);

CREATE INDEX idx_api_keys_tenant_created_id ON api_keys(tenant_id,created_at DESC,id);
