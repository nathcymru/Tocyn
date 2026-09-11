-- #73 persisted SLA policy and clock evidence. Target durations are deliberately
-- nullable: only the 24/7 UTC calendar is a product default.
CREATE TABLE sla_policies (
  tenant_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  response_target_ms INTEGER CHECK (response_target_ms IS NULL OR response_target_ms BETWEEN 60000 AND 7776000000),
  resolution_target_ms INTEGER CHECK (resolution_target_ms IS NULL OR resolution_target_ms BETWEEN 60000 AND 7776000000),
  calendar_json TEXT NOT NULL,
  response_reopen_policy TEXT NOT NULL DEFAULT 'continue' CHECK (response_reopen_policy IN ('continue','restart')),
  resolution_reopen_policy TEXT NOT NULL DEFAULT 'continue' CHECK (resolution_reopen_policy IN ('continue','restart')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sla_policy_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  actor_id TEXT NOT NULL,
  facts TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,revision)
);

CREATE TABLE ticket_sla_clocks (
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  response_started_at TEXT NOT NULL,
  response_due_at TEXT,
  response_completed_at TEXT,
  resolution_started_at TEXT NOT NULL,
  resolution_due_at TEXT,
  resolution_completed_at TEXT,
  paused_at TEXT,
  pause_reason TEXT CHECK (pause_reason IS NULL OR pause_reason IN ('waiting')),
  last_support_state_revision INTEGER NOT NULL DEFAULT 0 CHECK (last_support_state_revision >= 0),
  policy_revision INTEGER NOT NULL DEFAULT 0 CHECK (policy_revision >= 0),
  policy_calendar_json TEXT,
  policy_response_target_ms INTEGER,
  policy_resolution_target_ms INTEGER,
  policy_response_reopen_policy TEXT CHECK (policy_response_reopen_policy IS NULL OR policy_response_reopen_policy IN ('continue','restart')),
  policy_resolution_reopen_policy TEXT CHECK (policy_resolution_reopen_policy IS NULL OR policy_resolution_reopen_policy IN ('continue','restart')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (tenant_id,ticket_id),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_ticket_sla_clocks_due ON ticket_sla_clocks(tenant_id,response_due_at,resolution_due_at);

CREATE TABLE ticket_sla_pause_intervals (
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('waiting')),
  support_state_revision INTEGER NOT NULL CHECK (support_state_revision >= 0),
  PRIMARY KEY (tenant_id,ticket_id,started_at),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX idx_ticket_sla_open_pause ON ticket_sla_pause_intervals(tenant_id,ticket_id) WHERE ended_at IS NULL;

CREATE TABLE ticket_sla_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('clock.initialized','clock.paused','clock.resumed','clock.responded','clock.resolved','clock.reopened')),
  support_state_revision INTEGER NOT NULL CHECK (support_state_revision >= 0),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_id TEXT,
  facts TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES tickets(tenant_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_ticket_sla_events_transition ON ticket_sla_events(tenant_id,ticket_id,support_state_revision,kind);
