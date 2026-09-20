-- Staff corrections have their own optimistic revision. The triage clock's
-- revision records lifecycle transitions and must not fence classification.
ALTER TABLE tickets ADD COLUMN priority_classification_revision INTEGER NOT NULL DEFAULT 0
  CHECK (priority_classification_revision BETWEEN 0 AND 9007199254740991);

CREATE TABLE ticket_priority_classification_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  previous_revision INTEGER NOT NULL CHECK (previous_revision >= 0),
  next_revision INTEGER NOT NULL CHECK (next_revision = previous_revision + 1),
  before_classification TEXT CHECK (before_classification IS NULL OR json_valid(before_classification)),
  after_classification TEXT NOT NULL CHECK (json_valid(after_classification)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_ticket_priority_classification_events_ticket
  ON ticket_priority_classification_events(tenant_id,ticket_id,next_revision);
