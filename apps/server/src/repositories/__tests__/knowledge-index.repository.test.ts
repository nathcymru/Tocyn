import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from '../../../scripts/split-sql';
import { createVerifiedTenantScope } from '../../auth/scope';
import { KnowledgeIndexRepository, KNOWLEDGE_INDEX_CHUNK_BYTES, KNOWLEDGE_INDEX_MAX_CHUNKS, splitKnowledgeIndexText } from '../knowledge-index.repository';
import { TenantKnowledgeService, WidgetKnowledgeReader } from '../../services/tenant-knowledge.service';
import { createTenantRequestDeps } from '../../middleware/tenant.middleware';

const root = resolve(import.meta.dirname, '..', '..', '..');

async function fixture() {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'knowledge-index-manifest-proof', modules: true,
    compatibilityDate: '2024-04-03', script: 'export default { fetch(){ return new Response("ok") } }', d1Databases: { DB: 'knowledge-index-manifest-d1' },
    r2Buckets: ['ATTACHMENTS_BUCKET'],
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    for (const name of readdirSync(join(root, 'migrations')).filter(name => name.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(root, 'migrations', name), 'utf8')).map(sql => db.prepare(sql)));
    }
    await db.prepare("INSERT INTO knowledge_docs (tenant_id,id,title,file_path,status,tier) VALUES ('tenant-a','doc-a','A','knowledge/doc-a/body.md','pending','answer')").run();
    const scope = createVerifiedTenantScope('tenant-a', 'agent-a', ['agent'], 1);
    return { mf, db, scope, repo: new KnowledgeIndexRepository(db, scope) };
  } catch (error) { await mf.dispose(); throw error; }
}

test('UTF-8 splitter preserves a 10 MiB source exactly across bounded multibyte chunks', () => {
  const sourceBytes = 10 * 1024 * 1024;
  const euros = Math.floor(sourceBytes / 3);
  const source = '€'.repeat(euros) + 'a'.repeat(sourceBytes - euros * 3);
  const chunks = splitKnowledgeIndexText(source);
  assert.equal(new TextEncoder().encode(source).byteLength, sourceBytes);
  assert.ok(chunks.length <= KNOWLEDGE_INDEX_MAX_CHUNKS);
  assert.ok(chunks.every(chunk => new TextEncoder().encode(chunk).byteLength <= KNOWLEDGE_INDEX_CHUNK_BYTES));
  assert.equal(chunks.join(''), source);
  assert.ok(chunks.some(chunk => chunk.endsWith('€') || chunk.endsWith('a')), 'boundaries preserve complete Unicode scalars');
});

test('manifest retains pending work and stale versions are withdrawn without deleting cleanup ownership', async () => {
  const f = await fixture();
  try {
    const first = await f.repo.begin('doc-a', 'knowledge/doc-a/body.md', 'answer', null, 'a'.repeat(513));
    await f.repo.sourcePublished('doc-a', first.version, first.chunks);
    assert.equal(first.chunks.length, 2);
    assert.equal(await f.repo.next('doc-a', first.version), 0);
    assert.equal(await f.repo.reserveDispatch('doc-a', first.version), true);
    assert.equal(await f.repo.reserveDispatch('doc-a', first.version), true);
    assert.equal(await f.repo.reserveDispatch('doc-a', first.version), false);
    const claimed = await f.repo.claim('doc-a', first.version, 0);
    assert.equal(claimed?.text.length, 512);
    assert.equal(await f.repo.reserveDispatch('doc-a', first.version), true, 'claim resets the bounded next-continuation schedule');
    await f.repo.indexed('doc-a', first.version, 0);
    const second = await f.repo.begin('doc-a', 'knowledge/doc-a/body.md', 'answer', null, 'new');
    await f.repo.sourcePublished('doc-a', second.version, second.chunks);
    assert.equal(await f.repo.isCurrent('doc-a', first.version), false);
    await f.repo.withdrawAll('doc-a');
    const old = await f.db.prepare("SELECT state FROM knowledge_index_chunks WHERE tenant_id='tenant-a' AND document_id='doc-a' AND version=? AND chunk_index=0")
      .bind(first.version).first<{ state: string }>();
    assert.equal(old?.state, 'cleanup_pending');
    assert.equal((await f.db.prepare("SELECT state FROM knowledge_index_versions WHERE tenant_id='tenant-a' AND document_id='doc-a' AND version=?").bind(second.version).first<{ state: string }>())?.state, 'withdrawn');
  } finally { await f.mf.dispose(); }
});

test('failed manifest publication is failed and has no dispatchable partial job', async () => {
  const f = await fixture();
  try {
    const staged = await f.repo.begin('doc-a', 'knowledge/doc-a/body.md', 'answer', null, 'bounded');
    await assert.rejects(f.repo.sourcePublished('doc-a', staged.version, [staged.chunks[0], staged.chunks[0]]));
    assert.equal(await f.repo.next('doc-a', staged.version), null);
    assert.equal((await f.db.prepare(`SELECT state FROM knowledge_index_versions WHERE tenant_id=? AND document_id=? AND version=?`)
      .bind('tenant-a', 'doc-a', staged.version).first<{ state: string }>())?.state, 'failed');
    assert.equal((await f.db.prepare(`SELECT COUNT(*) AS count FROM knowledge_index_chunks WHERE tenant_id=? AND document_id=? AND version=?`)
      .bind('tenant-a', 'doc-a', staged.version).first<{ count: number }>())?.count, 0);
  } finally { await f.mf.dispose(); }
});

test('versioned QA cleanup retains and completes its bounded vector-id claim', async () => {
  const f = await fixture();
  try {
    const staged = await f.repo.begin('article-a', 'article/article-a', 'answer', null, 'qa body', 'article');
    await f.repo.sourcePublished('article-a', staged.version, staged.chunks);
    await f.repo.claim('article-a', staged.version, 0);
    await f.repo.indexed('article-a', staged.version, 0);
    await f.repo.completeIfFinished('article-a', staged.version);
    await f.repo.withdrawAll('article-a');
    const cleanup = await f.repo.claimArticleCleanup('article-a');
    assert.deepEqual(cleanup.map(chunk => chunk.vectorId), [`qa_article-a_v${staged.version}_0`]);
    const deleted: string[] = [];
    await (async (ids: readonly string[]) => { deleted.push(...ids); })(cleanup.map(chunk => chunk.vectorId));
    await f.repo.completeArticleCleanup('article-a', cleanup);
    assert.deepEqual(deleted, [`qa_article-a_v${staged.version}_0`]);
    assert.equal(await f.repo.hasPendingArticleCleanup('article-a'), false);
  } finally { await f.mf.dispose(); }
});

test('synthetic embedding completes a real D1/R2 manifest one bounded chunk at a time', async () => {
  const f = await fixture();
  try {
    const bucket = await f.mf.getR2Bucket('ATTACHMENTS_BUCKET');
    const vectors: { id: string; metadata: Record<string, unknown> }[] = [];
    const vectorIndex = {
      upsert: async (items: { id: string; metadata: Record<string, unknown> }[]) => { vectors.push(...items); },
      query: async () => ({ matches: [{ id: vectors[1]?.id, score: 0.9, metadata: vectors[1]?.metadata }] }),
    };
    const deps = createTenantRequestDeps(f.scope, {
      DB: f.db, ATTACHMENTS_BUCKET: bucket,
      VECTOR_INDEX: vectorIndex,
      JWT_SECRET: 'synthetic-test-secret',
    });
    const service = new TenantKnowledgeService(deps, {
      generateEmbeddings: async () => Array.from({ length: 1_024 }, () => 0),
    } as any);
    const id = await service.createArticle('Bounded article', 'a'.repeat(513));
    const version = await service.pendingIndexVersion(id);
    assert.equal(version, 1);
    assert.equal(await service.indexManifestChunk(id, version!, 0), 'next');
    assert.equal(await service.indexManifestChunk(id, version!, 1), 'complete');
    assert.equal(vectors.length, 2);
    assert.ok(vectors.every(vector => new TextEncoder().encode(vector.metadata.text as string).byteLength <= KNOWLEDGE_INDEX_CHUNK_BYTES));
    assert.equal((await deps.repositories.knowledge.getDocument(id))?.status, 'published');
    assert.equal(await service.pendingIndexVersion(id), null);
    const widget = new WidgetKnowledgeReader(deps, { generateEmbeddings: async () => Array.from({ length: 1_024 }, () => 0) } as any);
    assert.deepEqual(await widget.search('later chunk'), [{ content: 'a' }], 'a later selected vector returns its own current bounded chunk');
  } finally { await f.mf.dispose(); }
});

test('a provider failure becomes uncertain and never resets the paid chunk into an implicit retry', async () => {
  const f = await fixture();
  try {
    const bucket = await f.mf.getR2Bucket('ATTACHMENTS_BUCKET');
    let calls = 0;
    const deps = createTenantRequestDeps(f.scope, { DB: f.db, ATTACHMENTS_BUCKET: bucket,
      VECTOR_INDEX: { upsert: async () => { throw new Error('must not upsert'); } }, JWT_SECRET: 'synthetic-test-secret' });
    const service = new TenantKnowledgeService(deps, { generateEmbeddings: async () => { calls++; throw new Error('synthetic provider failure'); } } as any);
    const id = await service.createArticle('Failure', 'bounded');
    const version = await service.pendingIndexVersion(id);
    await assert.rejects(service.indexManifestChunk(id, version!, 0), /synthetic provider failure/);
    assert.equal(calls, 1);
    assert.equal(await service.indexManifestChunk(id, version!, 0), 'stale');
    assert.equal(calls, 1, 'a terminal uncertain claim cannot retry without an explicit recovery action');
  } finally { await f.mf.dispose(); }
});
