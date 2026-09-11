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

-- Session invalidation retains its all-agent behavior; admission reads one
-- maintained counter rather than scanning the tenant to estimate the scan.
CREATE TABLE admin_agent_population (
  tenant_id TEXT PRIMARY KEY,
  agent_rows INTEGER NOT NULL CHECK(agent_rows>=0)
);
INSERT INTO admin_agent_population(tenant_id,agent_rows)
  SELECT tenant_id,SUM(CASE WHEN role='agent' THEN 1 ELSE 0 END) FROM users GROUP BY tenant_id;
CREATE INDEX idx_users_admin_agent_population ON users(tenant_id,role,id);
CREATE TRIGGER admin_agent_population_insert AFTER INSERT ON users WHEN NEW.role='agent' BEGIN
  INSERT INTO admin_agent_population VALUES(NEW.tenant_id,1)
  ON CONFLICT(tenant_id) DO UPDATE SET agent_rows=agent_rows+1;
END;
CREATE TRIGGER admin_agent_population_delete AFTER DELETE ON users WHEN OLD.role='agent' BEGIN
  UPDATE admin_agent_population SET agent_rows=agent_rows-1 WHERE tenant_id=OLD.tenant_id;
END;
CREATE TRIGGER admin_agent_population_update AFTER UPDATE OF role,tenant_id ON users
WHEN OLD.role IS NOT NEW.role OR OLD.tenant_id IS NOT NEW.tenant_id BEGIN
  UPDATE admin_agent_population SET agent_rows=agent_rows-1 WHERE tenant_id=OLD.tenant_id AND OLD.role='agent';
  INSERT INTO admin_agent_population(tenant_id,agent_rows) SELECT NEW.tenant_id,1 WHERE NEW.role='agent'
  ON CONFLICT(tenant_id) DO UPDATE SET agent_rows=agent_rows+1;
END;
