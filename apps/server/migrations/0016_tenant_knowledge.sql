-- Phase 1, Batch 3: Tenant Knowledge Base migration

-- 1. Create Tenant-Scoped Knowledge Categories
CREATE TABLE tenant_knowledge_categories (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY(tenant_id, parent_id) REFERENCES tenant_knowledge_categories(tenant_id, id) ON DELETE RESTRICT
);

-- Backfill existing categories to 'default-tenant'
INSERT INTO tenant_knowledge_categories (tenant_id, id, name, parent_id, created_at)
SELECT 'default-tenant', id, name, parent_id, created_at FROM knowledge_categories;

-- 2. Create Tenant-Scoped Knowledge Docs
CREATE TABLE tenant_knowledge_docs (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    category_id TEXT,
    chunk_count INTEGER DEFAULT 0,
    tier TEXT CHECK(tier IN ('answer', 'sop')) DEFAULT 'answer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY(tenant_id, category_id) REFERENCES tenant_knowledge_categories(tenant_id, id) ON DELETE RESTRICT
);

-- Backfill existing docs to 'default-tenant'
INSERT INTO tenant_knowledge_docs (tenant_id, id, title, file_path, status, category_id, chunk_count, tier, created_at)
SELECT 'default-tenant', id, title, file_path, status, category_id, chunk_count, tier, created_at FROM knowledge_docs;

-- 3. Replace tables
DROP TABLE knowledge_docs;
DROP TABLE knowledge_categories;

ALTER TABLE tenant_knowledge_categories RENAME TO knowledge_categories;
ALTER TABLE tenant_knowledge_docs RENAME TO knowledge_docs;

-- 4. Background re-upsert legacy vectors task (DO NOT RUN IN PRODUCTION DDL)
-- Documenting that legacy production vectors must be backfilled/re-upserted into the 'default-tenant' namespace.
