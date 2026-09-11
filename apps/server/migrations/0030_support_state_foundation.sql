-- #136 additive support-state foundation. tickets.status remains the legacy API projection.
CREATE TABLE support_state_definitions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  legacy_status TEXT NOT NULL CHECK (legacy_status IN ('open','pending','resolved','closed')),
  internal_label TEXT NOT NULL CHECK (length(CAST(internal_label AS BLOB)) BETWEEN 1 AND 120),
  public_label TEXT NOT NULL CHECK (length(CAST(public_label AS BLOB)) BETWEEN 1 AND 120),
  waiting_reason_required INTEGER NOT NULL DEFAULT 0 CHECK (waiting_reason_required IN (0,1)),
  next_action_required INTEGER NOT NULL DEFAULT 0 CHECK (next_action_required IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (tenant_id,id)
);
-- Multiple tenant-defined states may project to the same legacy category.
CREATE INDEX idx_support_state_category ON support_state_definitions(tenant_id,legacy_status);

-- Separate facts preserve every existing ticket row and old payload shape.
CREATE TABLE ticket_support_state (
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  waiting_reason TEXT CHECK (waiting_reason IS NULL OR length(CAST(waiting_reason AS BLOB)) BETWEEN 1 AND 512),
  next_action TEXT CHECK (next_action IS NULL OR length(CAST(next_action AS BLOB)) BETWEEN 1 AND 512),
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (tenant_id,ticket_id),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,definition_id) REFERENCES support_state_definitions(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_ticket_support_state_definition ON ticket_support_state(tenant_id,definition_id);

-- Phase 1 has no global tenants table. Discover existing scoped identities/configuration;
-- future tenant initialization must establish these defaults before state assignment.
WITH existing_tenants(tenant_id) AS (
  SELECT tenant_id FROM users UNION SELECT tenant_id FROM tickets UNION SELECT tenant_id FROM tenant_config
), defaults(id,status,label) AS (
  VALUES ('legacy-open','open','Open'),('legacy-pending','pending','Pending'),
    ('legacy-resolved','resolved','Resolved'),('legacy-closed','closed','Closed')
)
INSERT INTO support_state_definitions(tenant_id,id,legacy_status,internal_label,public_label,waiting_reason_required,next_action_required)
SELECT tenant_id,id,status,label,label,0,0 FROM existing_tenants CROSS JOIN defaults;

INSERT INTO ticket_support_state(tenant_id,ticket_id,definition_id,changed_at)
SELECT tenant_id,id,'legacy-' || status,updated_at FROM tickets;
