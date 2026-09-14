-- Durable inbound claims are separate from staff/outbound delivery receipts.
-- Keep terminal identities: expiring a receipt must never silently replay mail.
CREATE TABLE inbound_email_receipts (
  tenant_id TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash)=64),
  envelope_hash TEXT NOT NULL CHECK (length(envelope_hash)=64),
  raw_hash TEXT CHECK (raw_hash IS NULL OR length(raw_hash)=64),
  recipient TEXT NOT NULL CHECK (length(recipient) BETWEEN 1 AND 320),
  current_attempt INTEGER NOT NULL CHECK (current_attempt BETWEEN 1 AND 3),
  state TEXT NOT NULL CHECK (state IN ('processing','committed','rejected','uncertain')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id,source_hash)
);

CREATE TABLE inbound_email_attempts (
  tenant_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  raw_hash TEXT CHECK (raw_hash IS NULL OR length(raw_hash)=64),
  manifest_ready INTEGER NOT NULL DEFAULT 0 CHECK (manifest_ready IN (0,1)),
  state TEXT NOT NULL CHECK (state IN ('processing','committed','rejected','uncertain')),
  reservation_id TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  operation_fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER,
  PRIMARY KEY (tenant_id,source_hash,attempt),
  FOREIGN KEY (tenant_id,source_hash) REFERENCES inbound_email_receipts(tenant_id,source_hash)
);

-- A planned row survives an uncertain R2 response. Attempt-qualified keys prevent
-- a late worker from overwriting a later recovery attempt's object.
CREATE TABLE inbound_email_artifacts (
  tenant_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 9),
  object_id TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash)=64),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 2097152),
  state TEXT NOT NULL CHECK (state IN ('planned','stored')),
  PRIMARY KEY (tenant_id,source_hash,attempt,ordinal),
  UNIQUE (tenant_id,object_id),
  FOREIGN KEY (tenant_id,source_hash,attempt) REFERENCES inbound_email_attempts(tenant_id,source_hash,attempt)
);
