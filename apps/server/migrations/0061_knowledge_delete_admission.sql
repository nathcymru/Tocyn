-- #64/#151: tenant-owned knowledge deletion retains a bounded cleanup manifest
-- until every external and derived artefact has a known deletion outcome.
CREATE TABLE knowledge_delete_jobs (
  tenant_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'document' CHECK (source_kind='document'),
  delete_token TEXT NOT NULL,
  legacy_file_path TEXT,
  legacy_vector_count INTEGER CHECK (legacy_vector_count IS NULL OR (legacy_vector_count>=0 AND legacy_vector_count<=20601)),
  max_version INTEGER NOT NULL CHECK (max_version>=0 AND max_version<=2147483647),
  legacy_source_done INTEGER NOT NULL DEFAULT 0 CHECK (legacy_source_done IN (0,1)),
  source_cursor INTEGER NOT NULL DEFAULT 0 CHECK (source_cursor>=0),
  sources_done INTEGER NOT NULL DEFAULT 0 CHECK (sources_done IN (0,1)),
  vector_version_cursor INTEGER NOT NULL DEFAULT 0 CHECK (vector_version_cursor>=0),
  vector_chunk_cursor INTEGER NOT NULL DEFAULT -1 CHECK (vector_chunk_cursor>=-1),
  legacy_vector_cursor INTEGER NOT NULL DEFAULT 0 CHECK (legacy_vector_cursor>=0),
  vectors_done INTEGER NOT NULL DEFAULT 0 CHECK (vectors_done IN (0,1)),
  state TEXT NOT NULL CHECK (state IN ('active','producer_unresolved','legacy_manifest_required','finalizing')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,document_id,source_kind),
  UNIQUE (tenant_id,delete_token)
);
CREATE INDEX idx_knowledge_delete_jobs_pending
  ON knowledge_delete_jobs(state,updated_at,tenant_id,document_id);

CREATE TABLE knowledge_delete_work (
  tenant_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'document' CHECK (source_kind='document'),
  delete_token TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('r2_source','vector_batch','finalize')),
  payload_json TEXT NOT NULL CHECK (length(CAST(payload_json AS BLOB))<=65536),
  state TEXT NOT NULL CHECK (state IN ('pending','claimed','uncertain','complete')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts>=0 AND attempts<=1000000),
  attempt_token INTEGER NOT NULL DEFAULT 0 CHECK (attempt_token>=0 AND attempt_token<=1000000),
  authority_revision INTEGER,
  recovery_reservation TEXT,
  authority_holder_id TEXT,
  authority_operation_id TEXT,
  authority_operation_fingerprint TEXT,
  authority_aggregate_id TEXT,
  lease_expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,document_id,source_kind,item_key)
);
CREATE INDEX idx_knowledge_delete_work_next
  ON knowledge_delete_work(tenant_id,document_id,source_kind,delete_token,state,item_key);

-- Finalization uses an opaque anti-resurrection marker inside its atomic batch.
-- It is removed with the completed job after all provider leases and durable
-- manifests have been invalidated; no new retention duration is invented.
CREATE TABLE knowledge_delete_tombstones (
  tenant_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'document' CHECK (source_kind='document'),
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,document_id,source_kind)
);

-- Required for complete document-only history without scanning colliding QA
-- versions. This extra index write must be included in source-attempt evidence.
CREATE INDEX idx_knowledge_index_versions_source_kind
  ON knowledge_index_versions(tenant_id,document_id,source_kind,version);

-- A deletion waits for an already-owned provider attempt to settle or expire.
ALTER TABLE knowledge_index_jobs ADD COLUMN provider_lease_expires_at TEXT;
ALTER TABLE knowledge_index_chunks ADD COLUMN provider_lease_expires_at TEXT;
UPDATE knowledge_index_jobs SET provider_lease_expires_at=datetime('now','+5 minutes') WHERE state='source_pending';
UPDATE knowledge_index_chunks SET provider_lease_expires_at=datetime('now','+5 minutes') WHERE state='claimed';
