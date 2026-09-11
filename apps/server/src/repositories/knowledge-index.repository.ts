import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';

export const KNOWLEDGE_INDEX_CHUNK_BYTES = 512;
// Three-byte UTF-8 scalars can leave two bytes unused in a 512-byte chunk.
// This is the exact worst-case count for the supported 10 MiB source.
export const KNOWLEDGE_INDEX_MAX_CHUNKS = 20_561;
export const KNOWLEDGE_INDEX_CLEANUP_BATCH = 100;
const encoder = new TextEncoder();

export type KnowledgeIndexChunk = Readonly<{ index: number; text: string; vectorId: string }>;
export type KnowledgeIndexVersion = Readonly<{ version: number; state: string; chunk_count: number; file_path: string; tier: 'answer'|'sop'; category_id: string | null; source_kind: 'document'|'article' }>;

/** Splits valid JS text only at UTF-8 code-point boundaries; no source bytes are dropped. */
export function splitKnowledgeIndexText(text: string): readonly string[] {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const scalar of text) {
    const bytes = encoder.encode(scalar).byteLength;
    if (bytes > KNOWLEDGE_INDEX_CHUNK_BYTES) throw new Error('Unsupported text scalar');
    if (currentBytes + bytes > KNOWLEDGE_INDEX_CHUNK_BYTES) { chunks.push(current); current = ''; currentBytes = 0; }
    current += scalar; currentBytes += bytes;
  }
  if (current || text.length === 0) chunks.push(current);
  if (chunks.length > KNOWLEDGE_INDEX_MAX_CHUNKS) throw new Error('Knowledge source exceeds the bounded indexing manifest');
  return chunks;
}

/** Tenant-scoped manifest and work ownership. Provider calls live above this repository. */
export class KnowledgeIndexRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  async begin(documentId: string, filePath: string, tier: 'answer'|'sop', categoryId: string | null, content: string,
    sourceKind: 'document'|'article' = 'document'): Promise<{ version: number; chunks: readonly KnowledgeIndexChunk[] }> {
    const latest = await this.db.prepare(`SELECT COALESCE(MAX(version),0) AS version FROM knowledge_index_versions
      WHERE tenant_id=? AND document_id=?`).bind(this.scope.tenantId, documentId).first<{ version: number }>();
    const version = (latest?.version ?? 0) + 1;
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid knowledge source version');
    const vectorPrefix = sourceKind === 'article' ? 'qa' : 'doc';
    const chunks = splitKnowledgeIndexText(content).map((text, index) => ({ index, text, vectorId: `${vectorPrefix}_${documentId}_v${version}_${index}` }));
    await this.db.batch([
      this.db.prepare(`INSERT INTO knowledge_index_versions
        (tenant_id,document_id,version,file_path,tier,category_id,source_kind,state,chunk_count) VALUES (?,?,?,?,?,?,?, 'source_pending',?)`)
        .bind(this.scope.tenantId, documentId, version, filePath, tier, categoryId, sourceKind, chunks.length),
      // Once a newer source has been accepted, older vector rows may no
      // longer be used. Their vector ids remain retained for a separately
      // admitted cleanup attempt.
      this.db.prepare(`UPDATE knowledge_index_versions SET state='withdrawn' WHERE tenant_id=? AND document_id=? AND version<?
        AND state NOT IN ('withdrawn','failed')`).bind(this.scope.tenantId, documentId, version),
      this.db.prepare(`UPDATE knowledge_index_chunks SET state='cleanup_pending' WHERE tenant_id=? AND document_id=? AND version<?
        AND state='indexed'`).bind(this.scope.tenantId, documentId, version),
      this.db.prepare(`UPDATE knowledge_index_jobs SET state='cleanup_pending' WHERE tenant_id=? AND document_id=? AND version<?
        AND state NOT IN ('complete','uncertain','cleanup_pending')`).bind(this.scope.tenantId, documentId, version),
    ]);
    return { version, chunks };
  }

  async sourcePublished(documentId: string, version: number, chunks: readonly KnowledgeIndexChunk[]): Promise<void> {
    const statements = [];
    for (const chunk of chunks) {
      if (encoder.encode(chunk.text).byteLength > KNOWLEDGE_INDEX_CHUNK_BYTES) throw new Error('Knowledge chunk exceeds embedding bound');
      statements.push(this.db.prepare(`INSERT INTO knowledge_index_chunks
        (tenant_id,document_id,version,chunk_index,chunk_text,state,vector_id) VALUES (?,?,?,?,?,'pending',?)`)
        .bind(this.scope.tenantId, documentId, version, chunk.index, chunk.text, chunk.vectorId));
    }
    try {
      // The source remains source_pending while these finite batches are
      // written. It cannot be dispatched or represented as successfully
      // indexed until the final atomic publication below.
      for (let offset = 0; offset < statements.length; offset += 100) await this.db.batch(statements.slice(offset, offset + 100));
      const final = await this.db.batch([
        this.db.prepare(`INSERT INTO knowledge_index_jobs (tenant_id,document_id,version,state)
          VALUES (?,?,?,'pending')`).bind(this.scope.tenantId, documentId, version),
        this.db.prepare(`UPDATE knowledge_index_versions SET state='pending'
          WHERE tenant_id=? AND document_id=? AND version=? AND state='source_pending'`).bind(this.scope.tenantId, documentId, version),
      ]);
      if (final[1].meta.changes !== 1) throw new Error('Knowledge source publication was superseded');
    } catch (error) {
      // A failed partial manifest is visible as failed and is fully removable;
      // no pending job can point at incomplete chunk rows.
      await this.sourceFailed(documentId, version);
      throw error;
    }
  }

  async sourceFailed(documentId: string, version: number): Promise<void> {
    await this.db.batch([
      this.db.prepare(`DELETE FROM knowledge_index_jobs WHERE tenant_id=? AND document_id=? AND version=? AND state='pending'`)
        .bind(this.scope.tenantId, documentId, version),
      this.db.prepare(`DELETE FROM knowledge_index_chunks WHERE tenant_id=? AND document_id=? AND version=? AND state='pending'`)
        .bind(this.scope.tenantId, documentId, version),
      this.db.prepare(`UPDATE knowledge_index_versions SET state='failed'
        WHERE tenant_id=? AND document_id=? AND version=? AND state='source_pending'`).bind(this.scope.tenantId, documentId, version),
    ]);
  }

  async current(documentId: string, version: number): Promise<KnowledgeIndexVersion | null> {
    return this.db.prepare(`SELECT version,state,chunk_count,file_path,tier,category_id,source_kind FROM knowledge_index_versions
      WHERE tenant_id=? AND document_id=? AND version=? LIMIT 1`).bind(this.scope.tenantId, documentId, version).first<KnowledgeIndexVersion>();
  }

  async isCurrent(documentId: string, version: number): Promise<boolean> {
    const row = await this.db.prepare(`SELECT MAX(version) AS version FROM knowledge_index_versions WHERE tenant_id=? AND document_id=?`)
      .bind(this.scope.tenantId, documentId).first<{ version: number | null }>();
    return row?.version === version;
  }

  async hasAny(documentId: string): Promise<boolean> {
    return !!await this.db.prepare(`SELECT 1 FROM knowledge_index_versions WHERE tenant_id=? AND document_id=? LIMIT 1`)
      .bind(this.scope.tenantId, documentId).first();
  }

  async latestPending(documentId: string): Promise<number | null> {
    const row = await this.db.prepare(`SELECT version FROM knowledge_index_versions
      WHERE tenant_id=? AND document_id=? AND state='pending' ORDER BY version DESC LIMIT 1`)
      .bind(this.scope.tenantId, documentId).first<{ version: number }>();
    return row?.version ?? null;
  }

  async next(documentId: string, version: number): Promise<number | null> {
    const job = await this.db.prepare(`SELECT next_chunk_index,state FROM knowledge_index_jobs WHERE tenant_id=? AND document_id=? AND version=? LIMIT 1`)
      .bind(this.scope.tenantId, documentId, version).first<{ next_chunk_index: number; state: string }>();
    if (!job || job.state !== 'pending') return null;
    const versionRow = await this.current(documentId, version);
    return versionRow && job.next_chunk_index < versionRow.chunk_count ? job.next_chunk_index : null;
  }

  /** One durable scheduling acknowledgement may be retried once. Claiming the
   * scheduled chunk resets this counter for the following continuation. */
  async reserveDispatch(documentId: string, version: number): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE knowledge_index_jobs SET dispatch_attempts=dispatch_attempts+1
      WHERE tenant_id=? AND document_id=? AND version=? AND state='pending' AND dispatch_attempts<2`)
      .bind(this.scope.tenantId, documentId, version).run();
    return result.meta.changes === 1;
  }

  async claim(documentId: string, version: number, chunkIndex: number): Promise<KnowledgeIndexChunk | null> {
    const claimed = await this.db.prepare(`UPDATE knowledge_index_chunks SET state='claimed',attempts=attempts+1
      WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? AND state='pending' AND attempts < 2`)
      .bind(this.scope.tenantId, documentId, version, chunkIndex).run();
    if (claimed.meta.changes !== 1) return null;
    await this.db.prepare(`UPDATE knowledge_index_jobs SET dispatch_attempts=0
      WHERE tenant_id=? AND document_id=? AND version=? AND state='pending' AND next_chunk_index=?`)
      .bind(this.scope.tenantId, documentId, version, chunkIndex).run();
    const row = await this.db.prepare(`SELECT chunk_index AS chunkIndex,chunk_text AS text,vector_id AS vectorId FROM knowledge_index_chunks
      WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? LIMIT 1`)
      .bind(this.scope.tenantId, documentId, version, chunkIndex).first<{ chunkIndex: number; text: string; vectorId: string }>();
    return row ? { index: row.chunkIndex, text: row.text, vectorId: row.vectorId } : null;
  }

  async indexed(documentId: string, version: number, chunkIndex: number): Promise<void> {
    await this.db.batch([
      this.db.prepare(`UPDATE knowledge_index_chunks SET state='indexed' WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? AND state='claimed'`)
        .bind(this.scope.tenantId, documentId, version, chunkIndex),
      this.db.prepare(`UPDATE knowledge_index_jobs SET next_chunk_index=next_chunk_index+1,state='pending'
        WHERE tenant_id=? AND document_id=? AND version=? AND next_chunk_index=?`).bind(this.scope.tenantId, documentId, version, chunkIndex),
    ]);
  }

  async completeIfFinished(documentId: string, version: number): Promise<boolean> {
    const versionRow = await this.current(documentId, version);
    if (!versionRow) return false;
    const result = await this.db.batch([
      this.db.prepare(`UPDATE knowledge_index_versions SET state='indexed' WHERE tenant_id=? AND document_id=? AND version=?
        AND state='pending' AND EXISTS (SELECT 1 FROM knowledge_index_jobs
          WHERE tenant_id=? AND document_id=? AND version=? AND state='pending' AND next_chunk_index=?)`)
        .bind(this.scope.tenantId, documentId, version, this.scope.tenantId, documentId, version, versionRow.chunk_count),
      this.db.prepare(`UPDATE knowledge_index_jobs SET state='complete' WHERE tenant_id=? AND document_id=? AND version=?
        AND state='pending' AND next_chunk_index=?`).bind(this.scope.tenantId, documentId, version, versionRow.chunk_count),
    ]);
    return result[1].meta.changes === 1;
  }

  async uncertain(documentId: string, version: number, chunkIndex: number): Promise<void> {
    await this.db.batch([
      this.db.prepare(`UPDATE knowledge_index_chunks SET state='uncertain' WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? AND state='claimed'`)
        .bind(this.scope.tenantId, documentId, version, chunkIndex),
      this.db.prepare(`UPDATE knowledge_index_jobs SET state='uncertain' WHERE tenant_id=? AND document_id=? AND version=?`)
        .bind(this.scope.tenantId, documentId, version),
      this.db.prepare(`UPDATE knowledge_index_versions SET state='failed' WHERE tenant_id=? AND document_id=? AND version=?`)
        .bind(this.scope.tenantId, documentId, version),
    ]);
  }

  /** Visibility revocation retains every vector id and cleanup claim durably. */
  async withdrawAll(documentId: string): Promise<void> {
    await this.db.batch([
      this.db.prepare(`UPDATE knowledge_index_versions SET state='withdrawn' WHERE tenant_id=? AND document_id=?
        AND state NOT IN ('withdrawn','failed')`).bind(this.scope.tenantId, documentId),
      this.db.prepare(`UPDATE knowledge_index_chunks SET state='cleanup_pending' WHERE tenant_id=? AND document_id=?
        AND state='indexed'`).bind(this.scope.tenantId, documentId),
      this.db.prepare(`UPDATE knowledge_index_jobs SET state='cleanup_pending' WHERE tenant_id=? AND document_id=?
        AND state NOT IN ('complete','uncertain')`).bind(this.scope.tenantId, documentId),
    ]);
  }

  /** Claims at most one Vectorize deletion batch under the caller's existing
   * retention claim. Rows remain owned if the external deletion fails. */
  async claimArticleCleanup(documentId: string, limit = KNOWLEDGE_INDEX_CLEANUP_BATCH): Promise<readonly { version: number; index: number; vectorId: string }[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > KNOWLEDGE_INDEX_CLEANUP_BATCH) throw new Error('Invalid cleanup batch limit');
    const rows = await this.db.prepare(`SELECT c.version,c.chunk_index AS chunkIndex,c.vector_id AS vectorId
      FROM knowledge_index_chunks c JOIN knowledge_index_versions v
        ON v.tenant_id=c.tenant_id AND v.document_id=c.document_id AND v.version=c.version
      WHERE c.tenant_id=? AND c.document_id=? AND c.state='cleanup_pending' AND v.source_kind='article'
      ORDER BY c.version,c.chunk_index LIMIT ?`).bind(this.scope.tenantId, documentId, limit)
      .all<{ version: number; chunkIndex: number; vectorId: string }>();
    const selected = rows.results;
    if (!selected.length) return [];
    await this.db.batch(selected.map(row => this.db.prepare(`UPDATE knowledge_index_chunks SET state='cleanup_claimed'
      WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? AND state='cleanup_pending'`)
      .bind(this.scope.tenantId, documentId, row.version, row.chunkIndex)));
    return selected.map(row => ({ version: row.version, index: row.chunkIndex, vectorId: row.vectorId }));
  }

  async completeArticleCleanup(documentId: string, chunks: readonly { version: number; index: number }[]): Promise<void> {
    await this.db.batch(chunks.map(chunk => this.db.prepare(`UPDATE knowledge_index_chunks SET state='cleaned'
      WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? AND state='cleanup_claimed'`)
      .bind(this.scope.tenantId, documentId, chunk.version, chunk.index)));
  }

  async releaseArticleCleanup(documentId: string, chunks: readonly { version: number; index: number }[]): Promise<void> {
    await this.db.batch(chunks.map(chunk => this.db.prepare(`UPDATE knowledge_index_chunks SET state='cleanup_pending'
      WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? AND state='cleanup_claimed'`)
      .bind(this.scope.tenantId, documentId, chunk.version, chunk.index)));
  }

  async hasPendingArticleCleanup(documentId: string): Promise<boolean> {
    return !!await this.db.prepare(`SELECT 1 FROM knowledge_index_chunks c JOIN knowledge_index_versions v
      ON v.tenant_id=c.tenant_id AND v.document_id=c.document_id AND v.version=c.version
      WHERE c.tenant_id=? AND c.document_id=? AND v.source_kind='article' AND c.state IN ('cleanup_pending','cleanup_claimed') LIMIT 1`)
      .bind(this.scope.tenantId, documentId).first();
  }
}
