-- #130: bounded, tenant-qualified discovery for due shared-snooze work.
-- A scheduler must never discover tenants with an unbounded DISTINCT scan of
-- support-state history. This projection is maintained whenever the canonical
-- snooze fact changes, and only exposes tenant identifiers to the pre-scope
-- scheduler boundary.
CREATE TABLE snooze_scheduler_tenants (
  tenant_id TEXT PRIMARY KEY,
  active_snoozes INTEGER NOT NULL CHECK (active_snoozes >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO snooze_scheduler_tenants (tenant_id,active_snoozes)
SELECT tenant_id,COUNT(*) FROM ticket_support_state
WHERE snoozed_until IS NOT NULL GROUP BY tenant_id;

CREATE INDEX idx_snooze_scheduler_tenants_active
  ON snooze_scheduler_tenants(active_snoozes,tenant_id);

CREATE TABLE snooze_scheduler_cursor (
  cursor_name TEXT PRIMARY KEY CHECK (cursor_name='tenant'),
  tenant_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER snooze_scheduler_support_state_insert
AFTER INSERT ON ticket_support_state
WHEN NEW.snoozed_until IS NOT NULL BEGIN
  INSERT INTO snooze_scheduler_tenants (tenant_id,active_snoozes)
  SELECT NEW.tenant_id,COUNT(*) FROM ticket_support_state
  WHERE tenant_id=NEW.tenant_id AND snoozed_until IS NOT NULL
  ON CONFLICT(tenant_id) DO UPDATE SET active_snoozes=excluded.active_snoozes,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER snooze_scheduler_support_state_update
AFTER UPDATE OF snoozed_until ON ticket_support_state BEGIN
  INSERT INTO snooze_scheduler_tenants (tenant_id,active_snoozes)
  SELECT NEW.tenant_id,COUNT(*) FROM ticket_support_state
  WHERE tenant_id=NEW.tenant_id AND snoozed_until IS NOT NULL
  ON CONFLICT(tenant_id) DO UPDATE SET active_snoozes=excluded.active_snoozes,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER snooze_scheduler_support_state_delete
AFTER DELETE ON ticket_support_state
WHEN OLD.snoozed_until IS NOT NULL BEGIN
  INSERT INTO snooze_scheduler_tenants (tenant_id,active_snoozes)
  SELECT OLD.tenant_id,COUNT(*) FROM ticket_support_state
  WHERE tenant_id=OLD.tenant_id AND snoozed_until IS NOT NULL
  ON CONFLICT(tenant_id) DO UPDATE SET active_snoozes=excluded.active_snoozes,updated_at=CURRENT_TIMESTAMP;
END;
