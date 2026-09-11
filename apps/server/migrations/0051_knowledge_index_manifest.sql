-- #64 shared prerequisite for #151: durable, tenant-scoped bounded indexing.
-- This does not introduce PDF extraction, source-page provenance or retrieval UI.
CREATE TABLE knowledge_index_versions (
  tenant_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'document' CHECK (source_kind IN ('document','article')),
  version INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('answer','sop')),
  category_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('source_pending','preparing','pending','indexing','indexed','failed','withdrawn')),
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0 AND chunk_count <= 20601),
  source_bytes INTEGER NOT NULL DEFAULT 0 CHECK (source_bytes >= 0 AND source_bytes <= 10485760),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, document_id, version)
);

CREATE TABLE knowledge_index_chunks (
  tenant_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0 AND chunk_index < 20601),
  chunk_text TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','claimed','indexed','failed','uncertain','cleanup_pending','cleanup_claimed','cleaned')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 2),
  vector_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, document_id, version, chunk_index)
);

-- A continuation is durable before it is dispatched. A duplicate Workflow
-- invocation claims the same row idempotently; it cannot create free work.
CREATE TABLE knowledge_index_jobs (
  tenant_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  next_chunk_index INTEGER NOT NULL DEFAULT 0 CHECK (next_chunk_index >= 0 AND next_chunk_index <= 20601),
  next_source_offset INTEGER NOT NULL DEFAULT 0 CHECK (next_source_offset >= 0 AND next_source_offset <= 10485760),
  state TEXT NOT NULL CHECK (state IN ('source_pending','preparing','pending','running','complete','failed','failed_cleanup','uncertain','cleanup_pending')),
  dispatch_attempts INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0 AND dispatch_attempts <= 2),
  PRIMARY KEY (tenant_id, document_id, version)
);

CREATE INDEX idx_knowledge_index_jobs_pending
  ON knowledge_index_jobs(tenant_id, state, document_id, version);
CREATE INDEX idx_knowledge_index_chunks_pending
  ON knowledge_index_chunks(tenant_id, document_id, version, state, chunk_index);

-- One durable target replaces unbounded historical-version or chunk updates.
CREATE TABLE knowledge_index_cleanup_jobs (
  tenant_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('document','article')),
  target_version INTEGER NOT NULL CHECK (target_version >= 1 AND target_version <= 2147483647),
  state TEXT NOT NULL CHECK (state IN ('pending','complete')) DEFAULT 'pending',
  dispatch_attempts INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0 AND dispatch_attempts <= 2),
  PRIMARY KEY (tenant_id, document_id, source_kind)
);
CREATE INDEX idx_knowledge_index_cleanup_target
  ON knowledge_index_cleanup_jobs(tenant_id, document_id, source_kind, target_version);
