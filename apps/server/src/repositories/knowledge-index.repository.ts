import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { KnowledgeSourceCommitFence } from '../budgets/knowledge-source-admission.service';
import { staffMutationStatements } from './staff-ticket-mutation.repository';
import { budgetGrantOperationConstraint, budgetGrantOperationStatements } from './budget-commit-fence';

export const KNOWLEDGE_INDEX_CHUNK_BYTES = 512;
// 127 four-byte scalars plus one ASCII scalar consume 509 bytes; a following
// four-byte scalar cannot fit. This is the least-dense greedy legal packing.
export const KNOWLEDGE_INDEX_MAX_CHUNKS = 20_601;
export const KNOWLEDGE_INDEX_CLEANUP_BATCH = 100;
export const KNOWLEDGE_INDEX_MANIFEST_BATCH = 100;
export const KNOWLEDGE_INDEX_MANIFEST_READ_BYTES = KNOWLEDGE_INDEX_MANIFEST_BATCH * KNOWLEDGE_INDEX_CHUNK_BYTES + 3;
const encoder = new TextEncoder();

export type KnowledgeIndexChunk = Readonly<{ index: number; text: string; vectorId: string }>;
export type KnowledgeIndexVersion = Readonly<{ version: number; state: string; chunk_count: number; file_path: string; tier: 'answer'|'sop'; category_id: string | null; source_kind: 'document'|'article'; source_bytes: number }>;
export type KnowledgeManifestPreparation = Readonly<{ version: number; filePath: string; tier: 'answer'|'sop'; categoryId: string | null; sourceKind: 'document'|'article'; sourceBytes: number; sourceOffset: number; chunkIndex: number }>;

/** Current staff/session plus the exact locally-spent operation. Every source
 * D1 mutation places these predicates in its own atomic batch. */
export function knowledgeSourceFenceStatements(db: D1Database, scope: VerifiedTenantScope,
  fence: KnowledgeSourceCommitFence, operationAlreadyLinked = false): readonly D1PreparedStatement[] {
  if (operationAlreadyLinked) return [staffMutationStatements(db,scope,fence,
    budgetGrantOperationConstraint(scope,fence.authority))[0]];
  return [staffMutationStatements(db,scope,fence)[0],...budgetGrantOperationStatements(db,scope,fence.authority)];
}

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

/** Decode only complete scalars from an R2 range. The next continuation starts
 * at the returned byte count, so no replacement character can enter a vector. */
export function decodeCompleteKnowledgePrefix(bytes: Uint8Array): Readonly<{ text: string; bytes: number }> {
  for (let omitted = 0; omitted <= 3 && omitted <= bytes.byteLength; omitted++) {
    try {
      const used = bytes.byteLength - omitted;
      return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, used)), bytes: used };
    } catch { /* a range may end in the first 1–3 bytes of a scalar */ }
  }
  throw new Error('Knowledge source range is not valid UTF-8');
}

/** Produces at most one durable manifest batch. A non-final short trailing
 * chunk remains in R2 for the next continuation rather than being duplicated. */
export function splitKnowledgeManifestBatch(text: string, sourceComplete: boolean): readonly string[] {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const scalar of text) {
    const bytes = encoder.encode(scalar).byteLength;
    if (currentBytes + bytes > KNOWLEDGE_INDEX_CHUNK_BYTES) {
      chunks.push(current);
      if (chunks.length === KNOWLEDGE_INDEX_MANIFEST_BATCH) return chunks;
      current = ''; currentBytes = 0;
    }
    current += scalar; currentBytes += bytes;
  }
  if (sourceComplete && (current || text.length === 0) && chunks.length < KNOWLEDGE_INDEX_MANIFEST_BATCH) chunks.push(current);
  return chunks;
}

function validSourceBytes(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 10 * 1024 * 1024;
}

/** Tenant-scoped manifest and work ownership. Every mutating method has a
 * fixed statement/row bound; external provider calls live above this repository. */
export class KnowledgeIndexRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  async begin(documentId: string, filePath: string, tier: 'answer'|'sop', categoryId: string | null, sourceBytes: number,
    sourceKind: 'document'|'article' = 'document', fence?: KnowledgeSourceCommitFence,
    sourceStatements: readonly D1PreparedStatement[] = [], retentionClaimed = false): Promise<{ version: number; filePath: string }> {
    if (!validSourceBytes(sourceBytes)) throw new Error('Invalid knowledge source size');
    const latest = await this.db.prepare(`SELECT COALESCE(MAX(version),0) AS version FROM knowledge_index_versions
      WHERE tenant_id=? AND document_id=?`).bind(this.scope.tenantId, documentId).first<{ version: number }>();
    const version = (latest?.version ?? 0) + 1;
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid knowledge source version');
    const versionFilePath = `${filePath}/versions/${version}`;
    // This intentionally does not update historical rows. Old sources remain
    // visible until a new manifest is indexed, then cleanup proceeds in 100-row
    // claims; version history can therefore never enlarge this request.
    if (sourceStatements.length > 2) throw new Error('Knowledge source mutation statement bound exceeded');
    await this.db.batch([
      ...(fence ? knowledgeSourceFenceStatements(this.db,this.scope,fence,retentionClaimed) : []),
      ...sourceStatements,
      this.db.prepare(`INSERT INTO knowledge_index_versions
        (tenant_id,document_id,version,file_path,tier,category_id,source_kind,state,chunk_count,source_bytes)
        SELECT ?,?,?,?,?,?,?,'source_pending',0,? WHERE ?!='document' OR
          (NOT EXISTS (SELECT 1 FROM knowledge_delete_jobs WHERE tenant_id=? AND document_id=? AND source_kind='document')
           AND NOT EXISTS (SELECT 1 FROM knowledge_delete_tombstones WHERE tenant_id=? AND document_id=? AND source_kind='document'))`)
        .bind(this.scope.tenantId, documentId, version, versionFilePath, tier, categoryId, sourceKind, sourceBytes, sourceKind,
          this.scope.tenantId,documentId,this.scope.tenantId,documentId),
      this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) VALUES (?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)
        ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId),
      // A QA attempt already owns a durable ticket write claim. Other source
      // attempts persist their recovery job before the R2 operation starts.
      ...(!retentionClaimed ? [this.db.prepare(`INSERT INTO knowledge_index_jobs
        (tenant_id,document_id,version,state,provider_lease_expires_at)
        VALUES (?,?,?,'source_pending',datetime('now','+5 minutes'))`).bind(this.scope.tenantId, documentId, version)] : []),
    ]);
    return { version, filePath: versionFilePath };
  }

  /** Source storage completed. The fixed preparation job is now recoverable. */
  async sourceCaptured(documentId: string, version: number, fence?: KnowledgeSourceCommitFence,
    sourceStatements: readonly D1PreparedStatement[] = []): Promise<boolean> {
    if (sourceStatements.length > 2) throw new Error('Knowledge source mutation statement bound exceeded');
    const prefix = fence ? knowledgeSourceFenceStatements(this.db,this.scope,fence,true) : [];
    const result = await this.db.batch([
      ...prefix,
      this.db.prepare(`UPDATE knowledge_index_versions SET state='preparing'
        WHERE tenant_id=? AND document_id=? AND version=? AND state='source_pending'
          AND (source_kind!='document' OR (NOT EXISTS (SELECT 1 FROM knowledge_delete_jobs WHERE tenant_id=? AND document_id=? AND source_kind='document')
            AND NOT EXISTS (SELECT 1 FROM knowledge_delete_tombstones WHERE tenant_id=? AND document_id=? AND source_kind='document')))`)
        .bind(this.scope.tenantId, documentId, version,this.scope.tenantId,documentId,this.scope.tenantId,documentId),
      this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) VALUES (?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)
        ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId),
      this.db.prepare(`INSERT INTO knowledge_index_jobs (tenant_id,document_id,version,state)
        VALUES (?,?,?,'preparing')
        ON CONFLICT(tenant_id,document_id,version) DO UPDATE SET state='preparing',dispatch_attempts=0,provider_lease_expires_at=NULL
          WHERE knowledge_index_jobs.state='source_pending'`).bind(this.scope.tenantId, documentId, version),
      this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) VALUES (?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)
        ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId),
      ...sourceStatements,
    ]);
    return result[prefix.length].meta.changes === 1 && result[prefix.length + 2].meta.changes === 1;
  }

  /** A live provider lease plus the deletion generation is the final ownership
   * check before an immutable document source can be written to R2. */
  async authorizeSourceEffect(documentId:string,version:number):Promise<boolean>{
    return !!await this.db.prepare(`SELECT 1 FROM knowledge_index_versions v LEFT JOIN knowledge_index_jobs j
      ON j.tenant_id=v.tenant_id AND j.document_id=v.document_id AND j.version=v.version
      WHERE v.tenant_id=? AND v.document_id=? AND v.version=? AND v.state='source_pending'
        AND (v.source_kind!='document' OR (j.state='source_pending' AND j.provider_lease_expires_at>CURRENT_TIMESTAMP))
        AND (v.source_kind!='document' OR
          (NOT EXISTS (SELECT 1 FROM knowledge_delete_jobs WHERE tenant_id=v.tenant_id AND document_id=v.document_id AND source_kind='document')
           AND NOT EXISTS (SELECT 1 FROM knowledge_delete_tombstones WHERE tenant_id=v.tenant_id AND document_id=v.document_id AND source_kind='document'))) LIMIT 1`)
      .bind(this.scope.tenantId,documentId,version).first();
  }

  async preparation(documentId: string, version: number): Promise<KnowledgeManifestPreparation | null> {
    return this.db.prepare(`SELECT v.version,v.file_path AS filePath,v.tier,v.category_id AS categoryId,v.source_kind AS sourceKind,
        v.source_bytes AS sourceBytes,j.next_source_offset AS sourceOffset,j.next_chunk_index AS chunkIndex
      FROM knowledge_index_versions v JOIN knowledge_index_jobs j
        ON j.tenant_id=v.tenant_id AND j.document_id=v.document_id AND j.version=v.version
      WHERE v.tenant_id=? AND v.document_id=? AND v.version=? AND v.state='preparing' AND j.state='preparing'
        AND (v.source_kind!='document' OR (NOT EXISTS (SELECT 1 FROM knowledge_delete_jobs WHERE tenant_id=v.tenant_id AND document_id=v.document_id AND source_kind='document')
          AND NOT EXISTS (SELECT 1 FROM knowledge_delete_tombstones WHERE tenant_id=v.tenant_id AND document_id=v.document_id AND source_kind='document'))) LIMIT 1`)
      .bind(this.scope.tenantId, documentId, version).first<KnowledgeManifestPreparation>();
  }

  async latestPreparation(documentId: string): Promise<number | null> {
    const row = await this.db.prepare(`SELECT version FROM knowledge_index_versions
      WHERE tenant_id=? AND document_id=? AND state='preparing'
        AND (source_kind!='document' OR (NOT EXISTS (SELECT 1 FROM knowledge_delete_jobs WHERE tenant_id=? AND document_id=? AND source_kind='document')
          AND NOT EXISTS (SELECT 1 FROM knowledge_delete_tombstones WHERE tenant_id=? AND document_id=? AND source_kind='document')))
        ORDER BY version DESC LIMIT 1`)
      .bind(this.scope.tenantId, documentId,this.scope.tenantId,documentId,this.scope.tenantId,documentId).first<{ version: number }>();
    return row?.version ?? null;
  }

  /** Atomically appends no more than 100 chunks and advances the R2 byte cursor. */
  async publishPreparationBatch(documentId: string, preparation: KnowledgeManifestPreparation, chunks: readonly string[], consumedBytes: number): Promise<'next'|'ready'|'stale'> {
    if (!chunks.length || chunks.length > KNOWLEDGE_INDEX_MANIFEST_BATCH || !Number.isSafeInteger(consumedBytes) || consumedBytes < 0) {
      throw new Error('Invalid knowledge manifest preparation batch');
    }
    const chunkBytes = chunks.reduce((total, chunk) => total + encoder.encode(chunk).byteLength, 0);
    if (chunkBytes !== consumedBytes || chunks.some(chunk => encoder.encode(chunk).byteLength > KNOWLEDGE_INDEX_CHUNK_BYTES)) {
      throw new Error('Knowledge manifest byte cursor mismatch');
    }
    const nextOffset = preparation.sourceOffset + consumedBytes;
    const nextIndex = preparation.chunkIndex + chunks.length;
    if (nextOffset > preparation.sourceBytes || nextIndex > KNOWLEDGE_INDEX_MAX_CHUNKS) throw new Error('Knowledge manifest bound exceeded');
    const ready = nextOffset === preparation.sourceBytes;
    const prefix = preparation.sourceKind === 'article' ? 'qa' : 'doc';
    const statements = chunks.map((text, offset) => this.db.prepare(`INSERT INTO knowledge_index_chunks
      (tenant_id,document_id,version,chunk_index,chunk_text,state,vector_id) VALUES (?,?,?,?,?,'pending',?)`)
      .bind(this.scope.tenantId, documentId, preparation.version, preparation.chunkIndex + offset, text,
        `${prefix}_${documentId}_v${preparation.version}_${preparation.chunkIndex + offset}`));
    statements.push(this.db.prepare(`UPDATE knowledge_index_jobs SET next_source_offset=?,next_chunk_index=?,state=?,dispatch_attempts=0
      WHERE tenant_id=? AND document_id=? AND version=? AND state='preparing' AND next_source_offset=? AND next_chunk_index=?
        AND (?!='document' OR (NOT EXISTS (SELECT 1 FROM knowledge_delete_jobs WHERE tenant_id=? AND document_id=? AND source_kind='document')
          AND NOT EXISTS (SELECT 1 FROM knowledge_delete_tombstones WHERE tenant_id=? AND document_id=? AND source_kind='document')))`)
      .bind(nextOffset, ready ? 0 : nextIndex, ready ? 'pending' : 'preparing', this.scope.tenantId, documentId, preparation.version,
        preparation.sourceOffset, preparation.chunkIndex,preparation.sourceKind,this.scope.tenantId,documentId,this.scope.tenantId,documentId));
    // A stale/superseded cursor must fail this transaction so the preceding
    // chunk inserts cannot survive without their cursor advancement.
    statements.push(this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) VALUES (?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)
      ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId));
    statements.push(this.db.prepare(`UPDATE knowledge_index_versions SET state=?,chunk_count=?
      WHERE tenant_id=? AND document_id=? AND version=? AND state='preparing'`)
      .bind(ready ? 'pending' : 'preparing', nextIndex, this.scope.tenantId, documentId, preparation.version));
    statements.push(this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) VALUES (?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)
      ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId));
    const result = await this.db.batch(statements);
    if (result[result.length - 4].meta.changes !== 1 || result[result.length - 2].meta.changes !== 1) return 'stale';
    return ready ? 'ready' : 'next';
  }

  /** A failed source remains durably terminal. Partial rows are reclaimed later
   * in bounded batches; failure never performs an unbounded DELETE. */
  async sourceFailed(documentId: string, version: number, fence?: KnowledgeSourceCommitFence): Promise<void> {
    await this.db.batch([
      ...(fence ? knowledgeSourceFenceStatements(this.db,this.scope,fence,true) : []),
      this.db.prepare(`UPDATE knowledge_index_versions SET state='failed'
        WHERE tenant_id=? AND document_id=? AND version=? AND (state IN ('source_pending','preparing') OR
          (state='withdrawn' AND source_kind='document' AND EXISTS (SELECT 1 FROM knowledge_delete_jobs
            WHERE tenant_id=? AND document_id=? AND source_kind='document')))`)
        .bind(this.scope.tenantId, documentId, version,this.scope.tenantId,documentId),
      this.db.prepare(`INSERT INTO knowledge_index_jobs (tenant_id,document_id,version,state)
        SELECT ?,?,?,'failed_cleanup' WHERE changes()=1
        ON CONFLICT(tenant_id,document_id,version) DO UPDATE SET state='failed_cleanup',dispatch_attempts=0,provider_lease_expires_at=NULL
          WHERE knowledge_index_jobs.state IN ('source_pending','preparing')`).bind(this.scope.tenantId, documentId, version),
      this.db.prepare(`UPDATE knowledge_delete_jobs SET state='active',updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=? AND document_id=? AND source_kind='document' AND state='producer_unresolved'
          AND EXISTS (SELECT 1 FROM knowledge_index_versions WHERE tenant_id=? AND document_id=? AND version=?
            AND source_kind='document' AND state='failed')`)
        .bind(this.scope.tenantId,documentId,this.scope.tenantId,documentId,version),
    ]);
  }

  /** Reclaims at most one incomplete source manifest batch. */
  async cleanupFailedSourceBatch(documentId: string, version: number): Promise<'next'|'complete'|'stale'> {
    const job = await this.db.prepare(`SELECT state FROM knowledge_index_jobs WHERE tenant_id=? AND document_id=? AND version=? LIMIT 1`)
      .bind(this.scope.tenantId, documentId, version).first<{ state: string }>();
    if (!job || job.state !== 'failed_cleanup') return 'stale';
    const deleted = await this.db.prepare(`DELETE FROM knowledge_index_chunks WHERE rowid IN (
      SELECT rowid FROM knowledge_index_chunks WHERE tenant_id=? AND document_id=? AND version=? AND state='pending' LIMIT ?
    )`).bind(this.scope.tenantId, documentId, version, KNOWLEDGE_INDEX_MANIFEST_BATCH).run();
    if (deleted.meta.changes === KNOWLEDGE_INDEX_MANIFEST_BATCH) return 'next';
    await this.db.prepare(`UPDATE knowledge_index_jobs SET state='failed' WHERE tenant_id=? AND document_id=? AND version=? AND state='failed_cleanup'`)
      .bind(this.scope.tenantId, documentId, version).run();
    return 'complete';
  }

  async current(documentId: string, version: number): Promise<KnowledgeIndexVersion | null> {
    return this.db.prepare(`SELECT version,state,chunk_count,file_path,tier,category_id,source_kind,source_bytes FROM knowledge_index_versions
      WHERE tenant_id=? AND document_id=? AND version=? LIMIT 1`).bind(this.scope.tenantId, documentId, version).first<KnowledgeIndexVersion>();
  }

  /** A source is current only once its full manifest is durable. */
  async isCurrent(documentId: string, version: number): Promise<boolean> {
    const row = await this.db.prepare(`SELECT MAX(version) AS version FROM knowledge_index_versions WHERE tenant_id=? AND document_id=?
      AND state IN ('pending','indexed')`).bind(this.scope.tenantId, documentId).first<{ version: number | null }>();
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

  async reserveDispatch(documentId: string, version: number): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE knowledge_index_jobs SET dispatch_attempts=dispatch_attempts+1
      WHERE tenant_id=? AND document_id=? AND version=? AND state IN ('preparing','pending','failed_cleanup') AND dispatch_attempts<2
        AND NOT EXISTS (SELECT 1 FROM knowledge_index_versions v JOIN knowledge_delete_jobs d
          ON d.tenant_id=v.tenant_id AND d.document_id=v.document_id AND d.source_kind='document'
          WHERE v.tenant_id=? AND v.document_id=? AND v.version=? AND v.source_kind='document')`)
      .bind(this.scope.tenantId, documentId, version,this.scope.tenantId,documentId,version).run();
    return result.meta.changes === 1;
  }

  async reserveDocumentCleanupDispatch(documentId: string): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE knowledge_index_cleanup_jobs SET dispatch_attempts=dispatch_attempts+1
      WHERE tenant_id=? AND document_id=? AND source_kind='document' AND state='pending' AND dispatch_attempts<2`)
      .bind(this.scope.tenantId, documentId).run();
    return result.meta.changes === 1;
  }

  async claim(documentId: string, version: number, chunkIndex: number): Promise<KnowledgeIndexChunk | null> {
    const claimed = await this.db.prepare(`UPDATE knowledge_index_chunks SET state='claimed',attempts=attempts+1,
      provider_lease_expires_at=datetime('now','+5 minutes')
      WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? AND state='pending' AND attempts < 2
        AND NOT EXISTS (SELECT 1 FROM knowledge_index_versions v JOIN knowledge_delete_jobs d
          ON d.tenant_id=v.tenant_id AND d.document_id=v.document_id AND d.source_kind='document'
          WHERE v.tenant_id=? AND v.document_id=? AND v.version=? AND v.source_kind='document')`)
      .bind(this.scope.tenantId, documentId, version, chunkIndex,this.scope.tenantId,documentId,version).run();
    if (claimed.meta.changes !== 1) return null;
    await this.db.prepare(`UPDATE knowledge_index_jobs SET dispatch_attempts=0
      WHERE tenant_id=? AND document_id=? AND version=? AND state='pending' AND next_chunk_index=?`)
      .bind(this.scope.tenantId, documentId, version, chunkIndex).run();
    const row = await this.db.prepare(`SELECT chunk_index AS chunkIndex,chunk_text AS text,vector_id AS vectorId FROM knowledge_index_chunks
      WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? LIMIT 1`)
      .bind(this.scope.tenantId, documentId, version, chunkIndex).first<{ chunkIndex: number; text: string; vectorId: string }>();
    return row ? { index: row.chunkIndex, text: row.text, vectorId: row.vectorId } : null;
  }

  async authorizeIndexEffect(documentId:string,version:number,chunkIndex:number):Promise<boolean>{
    return !!await this.db.prepare(`SELECT 1 FROM knowledge_index_chunks c JOIN knowledge_index_versions v
      ON v.tenant_id=c.tenant_id AND v.document_id=c.document_id AND v.version=c.version
      WHERE c.tenant_id=? AND c.document_id=? AND c.version=? AND c.chunk_index=? AND c.state='claimed'
        AND c.provider_lease_expires_at>CURRENT_TIMESTAMP AND (v.source_kind!='document' OR
          (NOT EXISTS (SELECT 1 FROM knowledge_delete_jobs WHERE tenant_id=c.tenant_id AND document_id=c.document_id AND source_kind='document')
           AND NOT EXISTS (SELECT 1 FROM knowledge_delete_tombstones WHERE tenant_id=c.tenant_id AND document_id=c.document_id AND source_kind='document'))) LIMIT 1`)
      .bind(this.scope.tenantId,documentId,version,chunkIndex).first();
  }

  async indexed(documentId: string, version: number, chunkIndex: number): Promise<boolean> {
    const result=await this.db.batch([
      this.db.prepare(`UPDATE knowledge_index_chunks SET state='indexed',provider_lease_expires_at=NULL
        WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? AND state='claimed'
          AND NOT EXISTS (SELECT 1 FROM knowledge_index_versions v JOIN knowledge_delete_jobs d
            ON d.tenant_id=v.tenant_id AND d.document_id=v.document_id AND d.source_kind='document'
            WHERE v.tenant_id=? AND v.document_id=? AND v.version=? AND v.source_kind='document')`)
        .bind(this.scope.tenantId, documentId, version, chunkIndex,this.scope.tenantId,documentId,version),
      this.db.prepare(`UPDATE knowledge_index_jobs SET next_chunk_index=next_chunk_index+1,state='pending'
        WHERE tenant_id=? AND document_id=? AND version=? AND next_chunk_index=?
          AND EXISTS (SELECT 1 FROM knowledge_index_chunks WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? AND state='indexed')`)
        .bind(this.scope.tenantId, documentId, version, chunkIndex,this.scope.tenantId,documentId,version,chunkIndex),
    ]);
    return result[0].meta.changes===1;
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
      this.db.prepare(`INSERT INTO knowledge_index_cleanup_jobs (tenant_id,document_id,source_kind,target_version,state)
        SELECT ?,?,?,?,'pending' WHERE ? > 1
        ON CONFLICT(tenant_id,document_id,source_kind) DO UPDATE SET target_version=MAX(target_version,excluded.target_version),state='pending',dispatch_attempts=0`)
        .bind(this.scope.tenantId, documentId, versionRow.source_kind, version - 1, version),
    ]);
    return result[1].meta.changes === 1;
  }

  async uncertain(documentId: string, version: number, chunkIndex: number): Promise<void> {
    await this.db.batch([
      this.db.prepare(`UPDATE knowledge_index_chunks SET state='uncertain',provider_lease_expires_at=NULL WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? AND state='claimed'`)
        .bind(this.scope.tenantId, documentId, version, chunkIndex),
      this.db.prepare(`UPDATE knowledge_index_jobs SET state='uncertain' WHERE tenant_id=? AND document_id=? AND version=?`)
        .bind(this.scope.tenantId, documentId, version),
      this.db.prepare(`UPDATE knowledge_index_versions SET state='failed' WHERE tenant_id=? AND document_id=? AND version=?`)
        .bind(this.scope.tenantId, documentId, version),
      this.db.prepare(`UPDATE knowledge_delete_jobs SET state='active',updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=? AND document_id=? AND source_kind='document' AND state='producer_unresolved'
          AND EXISTS (SELECT 1 FROM knowledge_index_versions WHERE tenant_id=? AND document_id=? AND version=? AND source_kind='document')`)
        .bind(this.scope.tenantId,documentId,this.scope.tenantId,documentId,version),
    ]);
  }

  /** Revocation is one current-version change plus a durable all-version
   * cleanup target. It never loops through a document's historical rows. */
  async withdrawAll(documentId: string): Promise<void> {
    const latest = await this.db.prepare(`SELECT version,source_kind FROM knowledge_index_versions
      WHERE tenant_id=? AND document_id=? ORDER BY version DESC LIMIT 1`).bind(this.scope.tenantId, documentId)
      .first<{ version: number; source_kind: 'document'|'article' }>();
    if (!latest) return;
    await this.db.batch([
      this.db.prepare(`UPDATE knowledge_index_versions SET state='withdrawn' WHERE tenant_id=? AND document_id=? AND version=?
        AND state NOT IN ('withdrawn','failed')`).bind(this.scope.tenantId, documentId, latest.version),
      this.db.prepare(`INSERT INTO knowledge_index_cleanup_jobs (tenant_id,document_id,source_kind,target_version,state)
        VALUES (?,?,?,?, 'pending') ON CONFLICT(tenant_id,document_id,source_kind)
        DO UPDATE SET target_version=MAX(target_version,excluded.target_version),state='pending',dispatch_attempts=0`)
        .bind(this.scope.tenantId, documentId, latest.source_kind, latest.version),
    ]);
  }

  private async claimCleanup(documentId: string, sourceKind: 'document'|'article', limit: number): Promise<readonly { version: number; index: number; vectorId: string }[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > KNOWLEDGE_INDEX_CLEANUP_BATCH) throw new Error('Invalid cleanup batch limit');
    const rows = await this.db.prepare(`SELECT c.version,c.chunk_index AS chunkIndex,c.vector_id AS vectorId
      FROM knowledge_index_chunks c JOIN knowledge_index_cleanup_jobs j
        ON j.tenant_id=c.tenant_id AND j.document_id=c.document_id
      JOIN knowledge_index_versions v ON v.tenant_id=c.tenant_id AND v.document_id=c.document_id AND v.version=c.version
      WHERE c.tenant_id=? AND c.document_id=? AND j.source_kind=? AND c.version<=j.target_version
        AND v.source_kind=j.source_kind AND c.state='indexed'
        AND (j.source_kind!='document' OR NOT EXISTS (SELECT 1 FROM knowledge_delete_jobs d
          WHERE d.tenant_id=c.tenant_id AND d.document_id=c.document_id AND d.source_kind='document'))
        ORDER BY c.version,c.chunk_index LIMIT ?`)
      .bind(this.scope.tenantId, documentId, sourceKind, limit).all<{ version: number; chunkIndex: number; vectorId: string }>();
    const selected = rows.results;
    if (!selected.length) return [];
    await this.db.batch(selected.map(row => this.db.prepare(`UPDATE knowledge_index_chunks SET state='cleanup_claimed'
      WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? AND state='indexed'`)
      .bind(this.scope.tenantId, documentId, row.version, row.chunkIndex)));
    await this.db.prepare(`UPDATE knowledge_index_cleanup_jobs SET dispatch_attempts=0 WHERE tenant_id=? AND document_id=? AND source_kind=?`)
      .bind(this.scope.tenantId, documentId, sourceKind).run();
    return selected.map(row => ({ version: row.version, index: row.chunkIndex, vectorId: row.vectorId }));
  }

  private async completeCleanup(documentId: string, chunks: readonly { version: number; index: number }[]): Promise<void> {
    if (!chunks.length) return;
    await this.db.batch(chunks.map(chunk => this.db.prepare(`UPDATE knowledge_index_chunks SET state='cleaned'
      WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? AND state='cleanup_claimed'`)
      .bind(this.scope.tenantId, documentId, chunk.version, chunk.index)));
  }

  private async releaseCleanup(documentId: string, chunks: readonly { version: number; index: number }[]): Promise<void> {
    if (!chunks.length) return;
    await this.db.batch(chunks.map(chunk => this.db.prepare(`UPDATE knowledge_index_chunks SET state='indexed'
      WHERE tenant_id=? AND document_id=? AND version=? AND chunk_index=? AND state='cleanup_claimed'`)
      .bind(this.scope.tenantId, documentId, chunk.version, chunk.index)));
  }

  async claimArticleCleanup(documentId: string, limit = KNOWLEDGE_INDEX_CLEANUP_BATCH) { return this.claimCleanup(documentId, 'article', limit); }
  async completeArticleCleanup(documentId: string, chunks: readonly { version: number; index: number }[]) { return this.completeCleanup(documentId, chunks); }
  async releaseArticleCleanup(documentId: string, chunks: readonly { version: number; index: number }[]) { return this.releaseCleanup(documentId, chunks); }
  async claimDocumentCleanup(documentId: string, limit = KNOWLEDGE_INDEX_CLEANUP_BATCH) { return this.claimCleanup(documentId, 'document', limit); }
  async completeDocumentCleanup(documentId: string, chunks: readonly { version: number; index: number }[]) { return this.completeCleanup(documentId, chunks); }
  async releaseDocumentCleanup(documentId: string, chunks: readonly { version: number; index: number }[]) { return this.releaseCleanup(documentId, chunks); }

  private async hasPendingCleanup(documentId: string, sourceKind: 'document'|'article'): Promise<boolean> {
    return !!await this.db.prepare(`SELECT 1 FROM knowledge_index_chunks c JOIN knowledge_index_cleanup_jobs j
      ON j.tenant_id=c.tenant_id AND j.document_id=c.document_id
      JOIN knowledge_index_versions v ON v.tenant_id=c.tenant_id AND v.document_id=c.document_id AND v.version=c.version
      WHERE c.tenant_id=? AND c.document_id=? AND j.source_kind=? AND c.version<=j.target_version
        AND v.source_kind=j.source_kind AND c.state IN ('indexed','cleanup_claimed') LIMIT 1`).bind(this.scope.tenantId, documentId, sourceKind).first();
  }
  async hasPendingArticleCleanup(documentId: string) { return this.hasPendingCleanup(documentId, 'article'); }
  async hasPendingDocumentCleanup(documentId: string) { return this.hasPendingCleanup(documentId, 'document'); }
}
