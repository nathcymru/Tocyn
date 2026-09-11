import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { KnowledgeIndexRepository, KNOWLEDGE_INDEX_CHUNK_BYTES, KNOWLEDGE_INDEX_MANIFEST_BATCH, KNOWLEDGE_INDEX_MAX_CHUNKS, splitKnowledgeIndexText } from '../src/repositories/knowledge-index.repository';
import { TenantKnowledgeService, WidgetKnowledgeReader } from '../src/services/tenant-knowledge.service';
import { createTenantRequestDeps } from '../src/middleware/tenant.middleware';

const root = resolve(import.meta.dirname, '..');
const size = (text: string) => new TextEncoder().encode(text).byteLength;
async function fixture() {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name:'knowledge-index-proof', modules:true, compatibilityDate:'2024-04-03', script:'export default { fetch(){ return new Response("ok") } }', d1Databases:{DB:'knowledge-index-d1'}, r2Buckets:['ATTACHMENTS_BUCKET'] }] }));
  try {
    const db = await mf.getD1Database('DB');
    for (const name of readdirSync(join(root,'migrations')).filter(n=>n.endsWith('.sql')).sort())
      await db.batch(splitSql(readFileSync(join(root,'migrations',name),'utf8')).map(sql=>db.prepare(sql)));
    await db.prepare("INSERT INTO knowledge_docs (tenant_id,id,title,file_path,status,tier) VALUES ('tenant-a','doc-a','A','knowledge/doc-a/body.md','pending','answer')").run();
    const scope=createVerifiedTenantScope('tenant-a','agent-a',['agent'],1);
    return {mf,db,scope,repo:new KnowledgeIndexRepository(db,scope)};
  } catch(error) { await mf.dispose(); throw error; }
}
async function ready(repo:KnowledgeIndexRepository,id:string,text:string,kind:'document'|'article'='document') {
  const started=await repo.begin(id,'knowledge/'+id+'/body.md','answer',null,size(text),kind);
  assert.equal(await repo.sourceCaptured(id,started.version),true);
  const prep=await repo.preparation(id,started.version); assert.ok(prep);
  const chunks=splitKnowledgeIndexText(text); assert.ok(chunks.length<=KNOWLEDGE_INDEX_MANIFEST_BATCH);
  assert.equal(await repo.publishPreparationBatch(id,prep!,chunks,size(text)),'ready');
  assert.equal(await repo.next(id,started.version),0,'Manifest preparation must start provider indexing at the first chunk');
  assert.equal(await repo.completeIfFinished(id,started.version),false,'Preparation is not provider indexing completion');
  return {version:started.version,chunks,filePath:started.filePath};
}
test('preserves full-size multibyte and 509-byte mixed-width source bounds',()=>{
  const total=10*1024*1024, unit='😀'.repeat(127)+'a';
  const mixed=unit.repeat(Math.floor(total/size(unit)))+'a'.repeat(total%size(unit));
  const euros='€'.repeat(Math.floor(total/3))+'a'.repeat(total%3);
  assert.equal(size(unit),509);
  for(const source of [mixed,euros]) {
    const chunks=splitKnowledgeIndexText(source);
    assert.equal(size(source),total); assert.equal(chunks.join(''),source);
    assert.ok(chunks.length<=KNOWLEDGE_INDEX_MAX_CHUNKS);
    assert.ok(chunks.every(c=>size(c)<=KNOWLEDGE_INDEX_CHUNK_BYTES));
  }
  assert.equal(splitKnowledgeIndexText(mixed).length,KNOWLEDGE_INDEX_MAX_CHUNKS);
});
test('same-document replacement keeps immutable source keys and claims old cleanup in a bounded batch',async()=>{
 const f=await fixture(); try {
   const one=await ready(f.repo,'doc-a','a'.repeat(513));
   await f.repo.claim('doc-a',one.version,0); await f.repo.indexed('doc-a',one.version,0);
   await f.repo.claim('doc-a',one.version,1); await f.repo.indexed('doc-a',one.version,1); assert.equal(await f.repo.completeIfFinished('doc-a',one.version),true);
   const two=await ready(f.repo,'doc-a','replacement');
   await f.repo.claim('doc-a',two.version,0); await f.repo.indexed('doc-a',two.version,0); assert.equal(await f.repo.completeIfFinished('doc-a',two.version),true);
   assert.notEqual(one.filePath,two.filePath); assert.equal(await f.repo.isCurrent('doc-a',one.version),false); assert.equal(await f.repo.isCurrent('doc-a',two.version),true);
   const cleanup=await f.repo.claimDocumentCleanup('doc-a'); assert.equal(cleanup.length,2); await f.repo.releaseDocumentCleanup('doc-a',cleanup); assert.equal(await f.repo.hasPendingDocumentCleanup('doc-a'),true);
 } finally {await f.mf.dispose();}
});
test('failed publication is durable and partial rows clean in bounded continuation',async()=>{
 const f=await fixture(); try {
   const start=await f.repo.begin('doc-a','knowledge/doc-a/body.md','answer',null,size('x'.repeat(513))); await f.repo.sourceCaptured('doc-a',start.version);
   const prep=await f.repo.preparation('doc-a',start.version); assert.ok(prep);
   assert.equal(await f.repo.publishPreparationBatch('doc-a',prep!,['x'.repeat(512)],512),'next');
   await f.repo.sourceFailed('doc-a',start.version); assert.equal(await f.repo.cleanupFailedSourceBatch('doc-a',start.version),'complete');
   assert.equal((await f.db.prepare("SELECT COUNT(*) count FROM knowledge_index_chunks WHERE tenant_id='tenant-a' AND document_id='doc-a' AND version=?").bind(start.version).first<{count:number}>())?.count,0);
 } finally {await f.mf.dispose();}
});
test('native R2 preparation is resumable and serves a later current chunk',async()=>{
 const f=await fixture(); try {
   const bucket=await f.mf.getR2Bucket('ATTACHMENTS_BUCKET'); const vectors:any[]=[];
   const deps=createTenantRequestDeps(f.scope,{DB:f.db,ATTACHMENTS_BUCKET:bucket,VECTOR_INDEX:{upsert:async(items:any[])=>vectors.push(...items),query:async()=>({matches:[{id:vectors[1]?.id,score:.9,metadata:vectors[1]?.metadata}]})},JWT_SECRET:'synthetic-test-secret'});
   const service=new TenantKnowledgeService(deps,{generateEmbeddings:async()=>Array.from({length:1024},()=>0)} as any);
   const id=await service.createArticle('A','a'.repeat(513)); const version=await service.pendingPreparationVersion(id); assert.equal(await service.prepareManifestBatch(id,version!), 'ready');
   const manifest=await f.db.prepare("SELECT chunk_count FROM knowledge_index_versions WHERE tenant_id='tenant-a' AND document_id=? AND version=?").bind(id,version).first<{chunk_count:number}>();
   assert.equal(manifest?.chunk_count,2); assert.equal(await service.indexManifestChunk(id,version!,0),'next'); assert.equal(await service.indexManifestChunk(id,version!,1),'complete');
   assert.deepEqual(await new WidgetKnowledgeReader(deps,{generateEmbeddings:async()=>Array.from({length:1024},()=>0)} as any).search('later'),[{content:'a'}]);
   const firstPath=(await deps.repositories.knowledge.getDocument(id))!.file_path;
   await service.updateArticle(id,'A replacement','replacement body');
   const secondPath=(await deps.repositories.knowledge.getDocument(id))!.file_path;
   assert.notEqual(firstPath,secondPath);
   assert.ok(await deps.attachmentStorage.getAttachment(firstPath));
   assert.ok(await deps.attachmentStorage.getAttachment(secondPath));
 } finally {await f.mf.dispose();}
});
test('full-size source prepares in fixed 100-row native batches without truncation',async()=>{
 const f=await fixture(); try {
   const bucket=await f.mf.getR2Bucket('ATTACHMENTS_BUCKET'), total=10*1024*1024, unit='😀'.repeat(127)+'a', source=unit.repeat(Math.floor(total/size(unit)))+'a'.repeat(total%size(unit));
   const deps=createTenantRequestDeps(f.scope,{DB:f.db,ATTACHMENTS_BUCKET:bucket,VECTOR_INDEX:{upsert:async()=>undefined},JWT_SECRET:'synthetic-test-secret'});
   const service=new TenantKnowledgeService(deps,{generateEmbeddings:async()=>Array.from({length:1024},()=>0)} as any); const id=await service.createArticle('Full',source); const version=(await service.pendingPreparationVersion(id))!;
   let batches=0, outcome:'next'|'ready'|'stale'|'missing'='next'; while(outcome==='next'){outcome=await service.prepareManifestBatch(id,version); batches++; assert.ok(batches<=Math.ceil(KNOWLEDGE_INDEX_MAX_CHUNKS/KNOWLEDGE_INDEX_MANIFEST_BATCH));}
   assert.equal(outcome,'ready'); const state=await f.db.prepare("SELECT chunk_count,source_bytes FROM knowledge_index_versions WHERE tenant_id='tenant-a' AND document_id=? AND version=?").bind(id,version).first<{chunk_count:number;source_bytes:number}>();
   assert.deepEqual(state,{chunk_count:KNOWLEDGE_INDEX_MAX_CHUNKS,source_bytes:total});
 } finally {await f.mf.dispose();}
});
