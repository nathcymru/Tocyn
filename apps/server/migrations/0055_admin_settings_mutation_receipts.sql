-- #64 bounded dashboard configuration receipts.  Responses contain only the
-- operation outcome, never configuration values or secrets.
CREATE TABLE admin_settings_mutation_receipts (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('dashboard.settings.update','dashboard.settings.theme.update','dashboard.permissions.update')),
  key_hash TEXT NOT NULL CHECK (length(key_hash)=64 AND key_hash NOT GLOB '*[^0-9a-f]*'),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash)=64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  response_status INTEGER NOT NULL CHECK (response_status=200),
  response_snapshot TEXT NOT NULL CHECK (json_valid(response_snapshot) AND length(CAST(response_snapshot AS BLOB))<=2048),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch()+86400),
  PRIMARY KEY (tenant_id,principal_id,operation,key_hash)
);
CREATE INDEX idx_admin_settings_receipts_expiry
  ON admin_settings_mutation_receipts(tenant_id,principal_id,expires_at);
