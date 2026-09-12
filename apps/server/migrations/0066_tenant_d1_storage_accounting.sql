-- Tenant-attributed D1 storage stock. This deliberately does not use D1
-- `meta.size_after`: that value describes the complete database and cannot be
-- safely assigned to one tenant.
CREATE TABLE tenant_d1_storage_accounts (
  tenant_id TEXT PRIMARY KEY,
  allocation_bytes INTEGER NOT NULL CHECK (allocation_bytes >= 0),
  allocation_revision INTEGER NOT NULL CHECK (allocation_revision >= 0),
  attributed_bytes INTEGER NOT NULL DEFAULT 0 CHECK (attributed_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  uncertain_bytes INTEGER NOT NULL DEFAULT 0 CHECK (uncertain_bytes >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
);

CREATE TABLE tenant_d1_storage_reservations (
  tenant_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  operation_fingerprint TEXT NOT NULL,
  allocation_revision INTEGER NOT NULL CHECK (allocation_revision >= 0),
  envelope_bytes INTEGER NOT NULL CHECK (envelope_bytes > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'uncertain', 'reconciled')),
  attributed_bytes INTEGER,
  evidence_id TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  state_changed_at INTEGER NOT NULL CHECK (state_changed_at >= 0),
  reconciled_at INTEGER,
  PRIMARY KEY (tenant_id, operation_id),
  CHECK ((status = 'reconciled' AND attributed_bytes IS NOT NULL AND evidence_id IS NOT NULL AND reconciled_at IS NOT NULL)
    OR (status != 'reconciled' AND attributed_bytes IS NULL AND evidence_id IS NULL AND reconciled_at IS NULL))
);

CREATE INDEX idx_tenant_d1_storage_reservations_status
  ON tenant_d1_storage_reservations (tenant_id, status, created_at);

-- The capacity check and reservation increment run in the same SQLite statement
-- as the insert. A concurrent reservation therefore cannot observe capacity that
-- another reservation has not already held.
CREATE TRIGGER tenant_d1_storage_reservation_holds_capacity
BEFORE INSERT ON tenant_d1_storage_reservations
WHEN NEW.status = 'reserved'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_d1_storage_accounts
    WHERE tenant_id = NEW.tenant_id
      AND allocation_revision = NEW.allocation_revision
      AND attributed_bytes + reserved_bytes + uncertain_bytes + NEW.envelope_bytes <= allocation_bytes
  ) THEN RAISE(ABORT, 'tenant_d1_storage_capacity_exhausted') END;

  UPDATE tenant_d1_storage_accounts
  SET reserved_bytes = reserved_bytes + NEW.envelope_bytes,
      updated_at = NEW.created_at
  WHERE tenant_id = NEW.tenant_id;
END;

-- State transitions carry their account movement in the same statement. A
-- dropped acknowledgement can therefore be retried safely without moving an
-- envelope from reserved to uncertain twice.
CREATE TRIGGER tenant_d1_storage_reservation_becomes_uncertain
BEFORE UPDATE OF status ON tenant_d1_storage_reservations
WHEN OLD.status = 'reserved' AND NEW.status = 'uncertain'
BEGIN
  UPDATE tenant_d1_storage_accounts
  SET reserved_bytes = reserved_bytes - OLD.envelope_bytes,
      uncertain_bytes = uncertain_bytes + OLD.envelope_bytes,
      updated_at = NEW.state_changed_at
  WHERE tenant_id = OLD.tenant_id;
END;

CREATE TRIGGER tenant_d1_storage_reservation_reconciles
BEFORE UPDATE OF status, attributed_bytes, evidence_id ON tenant_d1_storage_reservations
WHEN OLD.status IN ('reserved', 'uncertain') AND NEW.status = 'reconciled'
BEGIN
  SELECT CASE WHEN NEW.attributed_bytes < 0 OR NEW.attributed_bytes > OLD.envelope_bytes
    THEN RAISE(ABORT, 'tenant_d1_storage_reconciliation_outside_envelope') END;

  UPDATE tenant_d1_storage_accounts
  SET reserved_bytes = reserved_bytes - CASE WHEN OLD.status = 'reserved' THEN OLD.envelope_bytes ELSE 0 END,
      uncertain_bytes = uncertain_bytes - CASE WHEN OLD.status = 'uncertain' THEN OLD.envelope_bytes ELSE 0 END,
      attributed_bytes = attributed_bytes + NEW.attributed_bytes,
      updated_at = NEW.state_changed_at
  WHERE tenant_id = OLD.tenant_id;
END;
