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
  state TEXT NOT NULL CHECK (state IN ('source_pending','pending','indexing','indexed','failed','withdrawn')),
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0 AND chunk_count <= 20561),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, document_id, version)
);

CREATE TABLE knowledge_index_chunks (
  tenant_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0 AND chunk_index < 20561),
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
  next_chunk_index INTEGER NOT NULL DEFAULT 0 CHECK (next_chunk_index >= 0 AND next_chunk_index <= 20561),
  state TEXT NOT NULL CHECK (state IN ('pending','running','complete','failed','uncertain','cleanup_pending')),
  dispatch_attempts INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0 AND dispatch_attempts <= 2),
  PRIMARY KEY (tenant_id, document_id, version)
);

CREATE INDEX idx_knowledge_index_jobs_pending
  ON knowledge_index_jobs(tenant_id, state, document_id, version);
CREATE INDEX idx_knowledge_index_chunks_pending
  ON knowledge_index_chunks(tenant_id, document_id, version, state, chunk_index);
