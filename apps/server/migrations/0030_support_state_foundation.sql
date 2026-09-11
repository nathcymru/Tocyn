-- #136 additive support-state foundation. tickets.status remains the legacy API projection.
CREATE TABLE support_state_definitions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  legacy_status TEXT NOT NULL CHECK (legacy_status IN ('open','pending','resolved','closed')),
  internal_label TEXT NOT NULL CHECK (length(CAST(internal_label AS BLOB)) BETWEEN 1 AND 120),
  public_label TEXT NOT NULL CHECK (length(CAST(public_label AS BLOB)) BETWEEN 1 AND 120),
  waiting_reason_required INTEGER NOT NULL DEFAULT 0 CHECK (waiting_reason_required IN (0,1)),
  next_action_required INTEGER NOT NULL DEFAULT 0 CHECK (next_action_required IN (0,1)),
  is_compatibility_default INTEGER NOT NULL DEFAULT 0 CHECK (is_compatibility_default IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1) AND (is_compatibility_default=0 OR is_active=1)),
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
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  -- An explicit support-state transition marks its row while it projects the
  -- legacy category. The legacy-status trigger leaves that single atomic
  -- transition intact, then the service clears the marker before returning.
  transition_token TEXT,
  PRIMARY KEY (tenant_id,ticket_id),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,definition_id) REFERENCES support_state_definitions(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_ticket_support_state_definition ON ticket_support_state(tenant_id,definition_id);

-- Private, tenant-qualified evidence for definition administration and state
-- transitions. Conversation events retain the ticket-history projection.
CREATE TABLE support_state_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ticket_id TEXT,
  definition_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('definition.created','definition.updated','definition.deactivated','ticket.transition')),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('staff','system')),
  actor_id TEXT,
  facts TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,definition_id) REFERENCES support_state_definitions(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_support_state_events_ticket ON support_state_events(tenant_id,ticket_id,recorded_at);

-- Phase 1 has no global tenants table. Discover existing scoped identities/configuration;
-- future tenant initialization must establish these defaults before state assignment.
WITH existing_tenants(tenant_id) AS (
  SELECT tenant_id FROM users UNION SELECT tenant_id FROM tickets UNION SELECT tenant_id FROM tenant_config
), defaults(id,status,label) AS (
  VALUES ('legacy-open','open','Open'),('legacy-pending','pending','Pending'),
    ('legacy-resolved','resolved','Resolved'),('legacy-closed','closed','Closed')
)
INSERT INTO support_state_definitions(tenant_id,id,legacy_status,internal_label,public_label,waiting_reason_required,next_action_required,is_compatibility_default)
SELECT tenant_id,id,status,label,label,0,0,1 FROM existing_tenants CROSS JOIN defaults;

INSERT INTO ticket_support_state(tenant_id,ticket_id,definition_id,changed_at)
SELECT tenant_id,id,'legacy-' || status,updated_at FROM tickets;

-- A tenant can be introduced after this migration. The first ticket safely
-- receives every compatibility definition and its matching state fact.
CREATE TRIGGER support_state_defaults_on_ticket_insert AFTER INSERT ON tickets BEGIN
  INSERT OR IGNORE INTO support_state_definitions(tenant_id,id,legacy_status,internal_label,public_label,is_compatibility_default)
    VALUES (NEW.tenant_id,'legacy-open','open','Open','Open',1);
  INSERT OR IGNORE INTO support_state_definitions(tenant_id,id,legacy_status,internal_label,public_label,is_compatibility_default)
    VALUES (NEW.tenant_id,'legacy-pending','pending','Pending','Pending',1);
  INSERT OR IGNORE INTO support_state_definitions(tenant_id,id,legacy_status,internal_label,public_label,is_compatibility_default)
    VALUES (NEW.tenant_id,'legacy-resolved','resolved','Resolved','Resolved',1);
  INSERT OR IGNORE INTO support_state_definitions(tenant_id,id,legacy_status,internal_label,public_label,is_compatibility_default)
    VALUES (NEW.tenant_id,'legacy-closed','closed','Closed','Closed',1);
  INSERT INTO ticket_support_state(tenant_id,ticket_id,definition_id)
    VALUES (NEW.tenant_id,NEW.id,'legacy-' || NEW.status)
    ON CONFLICT(tenant_id,ticket_id) DO NOTHING;
END;

-- Existing clients still update tickets.status directly. Their writes retain
-- the matching compatibility state and deliberately clear private waiting
-- facts. Explicit state transitions use transition_token inside their atomic
-- D1 batch and are therefore not overwritten by this compatibility projection.
CREATE TRIGGER support_state_sync_legacy_status AFTER UPDATE OF status ON tickets
WHEN OLD.status IS NOT NEW.status BEGIN
  INSERT OR IGNORE INTO support_state_definitions(tenant_id,id,legacy_status,internal_label,public_label,is_compatibility_default)
    VALUES (NEW.tenant_id,'legacy-open','open','Open','Open',1);
  INSERT OR IGNORE INTO support_state_definitions(tenant_id,id,legacy_status,internal_label,public_label,is_compatibility_default)
    VALUES (NEW.tenant_id,'legacy-pending','pending','Pending','Pending',1);
  INSERT OR IGNORE INTO support_state_definitions(tenant_id,id,legacy_status,internal_label,public_label,is_compatibility_default)
    VALUES (NEW.tenant_id,'legacy-resolved','resolved','Resolved','Resolved',1);
  INSERT OR IGNORE INTO support_state_definitions(tenant_id,id,legacy_status,internal_label,public_label,is_compatibility_default)
    VALUES (NEW.tenant_id,'legacy-closed','closed','Closed','Closed',1);
  INSERT INTO ticket_support_state(tenant_id,ticket_id,definition_id,waiting_reason,next_action)
    SELECT NEW.tenant_id,NEW.id,'legacy-' || NEW.status,NULL,NULL
    WHERE NOT EXISTS (SELECT 1 FROM ticket_support_state s
      WHERE s.tenant_id=NEW.tenant_id AND s.ticket_id=NEW.id AND s.transition_token IS NOT NULL)
    ON CONFLICT(tenant_id,ticket_id) DO UPDATE SET
      definition_id=excluded.definition_id, waiting_reason=NULL, next_action=NULL,
      changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), revision=ticket_support_state.revision+1, transition_token=NULL
    WHERE ticket_support_state.transition_token IS NULL;
END;
