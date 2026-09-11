-- #66 presentation preference has its own CAS revision, independent of ticket navigation.
CREATE TABLE operator_theme_preference (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  mode TEXT NOT NULL CHECK (mode IN ('light','dark','system')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (tenant_id,user_id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);
