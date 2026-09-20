-- #317 fixed-hour triage clock. This is independent of contractual SLA clocks
-- and calendars; its own waiting, snooze and resolved pauses retain time debt.
-- Existing tickets are not backfilled: their actual ingestion start and
-- inactive history are unknown.
CREATE TABLE ticket_priority_clocks (
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  started_at TEXT NOT NULL CHECK (length(CAST(started_at AS BLOB)) BETWEEN 19 AND 64),
  active_since TEXT CHECK (active_since IS NULL OR length(CAST(active_since AS BLOB)) BETWEEN 19 AND 64),
  accrued_active_ms INTEGER NOT NULL DEFAULT 0 CHECK (accrued_active_ms BETWEEN 0 AND 9007199254740991),
  stop_reason TEXT CHECK (stop_reason IS NULL OR stop_reason IN ('waiting','snoozed','resolved')),
  last_support_state_revision INTEGER NOT NULL DEFAULT 1 CHECK (last_support_state_revision >= 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL CHECK (length(CAST(updated_at AS BLOB)) BETWEEN 19 AND 64),
  PRIMARY KEY (tenant_id,ticket_id),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE,
  CHECK ((active_since IS NULL) = (stop_reason IS NOT NULL))
);

-- Ticket creation is the sole initialization point. This trigger is installed
-- after migration data, so it cannot invent clocks for historical rows.
CREATE TRIGGER priority_clock_on_ticket_insert AFTER INSERT ON tickets BEGIN
  INSERT INTO ticket_priority_clocks
    (tenant_id,ticket_id,started_at,active_since,stop_reason,last_support_state_revision,updated_at)
  VALUES (
    NEW.tenant_id,NEW.id,COALESCE(NEW.intake_received_at,NEW.created_at),
    CASE WHEN NEW.status IN ('resolved','closed') THEN NULL ELSE COALESCE(NEW.intake_received_at,NEW.created_at) END,
    CASE WHEN NEW.status IN ('resolved','closed') THEN 'resolved' ELSE NULL END,
    1,COALESCE(NEW.intake_received_at,NEW.created_at)
  );
END;

-- Support-state updates are performed under the existing canonical mutation
-- and admission batch. The row's state revision is the replay/concurrency fence.
-- The legacy tickets.status projection also updates ticket_support_state, so
-- both mutation paths pass through this single clock accounting boundary.
CREATE TRIGGER priority_clock_on_support_state_update
AFTER UPDATE OF definition_id,waiting_reason,snoozed_until ON ticket_support_state
WHEN NEW.revision > OLD.revision BEGIN
  UPDATE ticket_priority_clocks SET
    accrued_active_ms = accrued_active_ms + CASE WHEN active_since IS NOT NULL AND (
      SELECT d.legacy_status IN ('resolved','closed') OR
        (d.legacy_status='pending' AND NEW.waiting_reason IS NOT NULL) OR
        NEW.snoozed_until IS NOT NULL
      FROM support_state_definitions d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.definition_id
    ) THEN MAX(0,
      (CAST(strftime('%s',NEW.changed_at) AS INTEGER)*1000 + CAST(substr(strftime('%f',NEW.changed_at),4,3) AS INTEGER)) -
      (CAST(strftime('%s',active_since) AS INTEGER)*1000 + CAST(substr(strftime('%f',active_since),4,3) AS INTEGER))
    ) ELSE 0 END,
    active_since = CASE WHEN (
      SELECT d.legacy_status IN ('resolved','closed') OR
        (d.legacy_status='pending' AND NEW.waiting_reason IS NOT NULL) OR
        NEW.snoozed_until IS NOT NULL
      FROM support_state_definitions d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.definition_id
    ) THEN NULL ELSE COALESCE(active_since,
      -- A manual/customer-reply wake after a missed deadline inherits time
      -- since that deadline too; an early wake starts at its actual change.
      CASE WHEN OLD.snoozed_until IS NOT NULL AND NEW.snoozed_until IS NULL
        THEN MIN(OLD.snoozed_until,NEW.changed_at) ELSE NEW.changed_at END) END,
    stop_reason = (
      SELECT CASE WHEN d.legacy_status IN ('resolved','closed') THEN 'resolved'
        WHEN d.legacy_status='pending' AND NEW.waiting_reason IS NOT NULL THEN 'waiting'
        WHEN NEW.snoozed_until IS NOT NULL THEN 'snoozed' ELSE NULL END
      FROM support_state_definitions d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.definition_id
    ),
    last_support_state_revision=NEW.revision,
    revision=revision+1,
    updated_at=NEW.changed_at
  WHERE tenant_id=NEW.tenant_id AND ticket_id=NEW.ticket_id
    AND last_support_state_revision<NEW.revision;
END;
