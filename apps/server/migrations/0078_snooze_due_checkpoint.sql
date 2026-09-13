-- #130: bounded checkpoint for the separately admitted local due composition.
-- One row per trusted catalogue tenant; no TTL/reset or ticket FK cascade.
CREATE TABLE snooze_due_checkpoint (
  tenant_id TEXT PRIMARY KEY CHECK(length(CAST(tenant_id AS BLOB)) BETWEEN 1 AND 160),
  generation INTEGER NOT NULL CHECK(typeof(generation)='integer' AND generation BETWEEN 1 AND 9007199254740991),
  step_id TEXT NOT NULL CHECK(length(step_id)=36),
  due_through TEXT NOT NULL CHECK(length(CAST(due_through AS BLOB))=24),
  ticket_id TEXT CHECK(ticket_id IS NULL OR length(CAST(ticket_id AS BLOB)) BETWEEN 1 AND 160),
  original_revision INTEGER,
  original_deadline TEXT,
  definition_id TEXT CHECK(definition_id IS NULL OR length(CAST(definition_id AS BLOB)) BETWEEN 1 AND 160),
  outcome TEXT NOT NULL CHECK(outcome IN ('empty','resurfaced')),
  original_aggregate_id TEXT NOT NULL CHECK(length(CAST(original_aggregate_id AS BLOB)) BETWEEN 1 AND 160),
  original_reservation_id TEXT NOT NULL CHECK(length(CAST(original_reservation_id AS BLOB)) BETWEEN 1 AND 160),
  original_holder_id TEXT NOT NULL CHECK(length(CAST(original_holder_id AS BLOB)) BETWEEN 1 AND 160),
  original_operation_id TEXT NOT NULL CHECK(length(CAST(original_operation_id AS BLOB)) BETWEEN 1 AND 160),
  original_operation_fingerprint TEXT NOT NULL CHECK(length(CAST(original_operation_fingerprint AS BLOB)) BETWEEN 1 AND 160),
  CHECK((outcome='empty' AND ticket_id IS NULL AND original_revision IS NULL
    AND original_deadline IS NULL AND definition_id IS NULL)
    OR (outcome='resurfaced' AND ticket_id IS NOT NULL AND original_revision IS NOT NULL AND typeof(original_revision)='integer' AND original_revision BETWEEN 1 AND 9007199254740990
      AND original_deadline IS NOT NULL AND length(CAST(original_deadline AS BLOB))=24 AND definition_id IS NOT NULL))
);
