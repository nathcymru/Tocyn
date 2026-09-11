import type { R2Bucket } from '@cloudflare/workers-types';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { D1Database, D1PreparedStatement, DurableObjectNamespace } from '@cloudflare/workers-types';
import { splitSql } from './split-sql';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { BudgetAuthorityRepository } from '../src/repositories/budget-authority.repository';
import { CapabilityPolicyService } from '../src/repositories/capability-policy.repository';
import { SESSION_BUDGET_GROUP_CAPABILITY_SQL, SessionBudgetAuthorityRepository, type SessionBudgetCredential, type SessionBudgetRequirements } from '../src/repositories/session-budget-authority.repository';
import { IsolateBudgetAdmissionCache } from '../src/budgets/isolate-admission.service';
import { SessionBudgetAdmissionService } from '../src/budgets/session-admission.service';
import { admitKnowledgeSourceWrite, KNOWLEDGE_SOURCE_WRITE_ENVELOPES } from '../src/budgets/knowledge-source-admission.service';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
import { createTenantRequestDeps } from '../src/middleware/tenant.middleware';
import { TenantKnowledgeService } from '../src/services/tenant-knowledge.service';

const NOW = Math.floor(Date.now()/1_000)*1_000;
const root = resolve(import.meta.dirname, '..');

type NativeD1WriteMeter = Readonly<{
  database: D1Database;
  reset: () => void;
  rowsWritten: () => number;
  samples: () => readonly (readonly number[])[];
}>;

/** Sums the native D1 rows_written metadata across every statement in a whole
 * source attempt. Batch statement results are counted once at the DB boundary. */
function meterNativeD1Writes(database: D1Database): NativeD1WriteMeter {
  let rowsWritten = 0;
  let samples: number[][] = [];
  const rawStatements = new WeakMap<object, D1PreparedStatement>();
  const record = (result: any): any => {
    const results = Array.isArray(result) ? result : [result];
    for (const item of results) {
      const rows = item?.meta?.rows_written;
      assert.equal(Number.isSafeInteger(rows) && rows >= 0, true, 'native D1 result exposes rows_written metadata');
      rowsWritten += rows;
    }
    samples.push(results.map(item=>item.meta.rows_written));
    return result;
  };
  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement as any, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (property === 'bind') return (...args: unknown[]) => wrapStatement(value.apply(target,args));
        if (property === 'run' || property === 'all') return async (...args: unknown[]) => record(await value.apply(target,args));
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as D1PreparedStatement;
    rawStatements.set(proxy as object,statement);
    return proxy;
  };
  const metered = new Proxy(database as any, {
    get(target,property) {
      const value = Reflect.get(target,property);
      if (property === 'prepare') return (sql: string) => wrapStatement(value.call(target,sql));
      if (property === 'batch') return async (statements: D1PreparedStatement[]) => record(await value.call(target,
        statements.map(statement=>rawStatements.get(statement as object) ?? statement)));
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as D1Database;
  return {database:metered,reset:()=>{rowsWritten=0;samples=[];},rowsWritten:()=>rowsWritten,samples:()=>samples};
}

/** Real D1/DO adapter proof; token signature verification and dashboard HTTP wiring are not claimed here. */
async function fixture(workerLimit = 1_000) {
  const bundled = await build({ entryPoints: ['scripts/budget-coordinator-do-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'session-budget-proof', modules: true,
    compatibilityDate: '2024-04-03', script: bundled.outputFiles[0].text, d1Databases: { DB: 'session-budget-d1' },
    r2Buckets: { ATTACHMENTS_BUCKET: 'session-budget-r2' },
    durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' }, unsafeEphemeralDurableObjects: true,
  }] }));
  try {
  const db = await mf.getD1Database('DB');
  for (const migration of readdirSync(join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
    await db.batch(splitSql(readFileSync(join(root, 'migrations', migration), 'utf8')).map(sql => db.prepare(sql)));
  }
  const limits = { workerRequests: workerLimit, d1RowsRead: 10_000_000, d1RowsWritten: 100_000,
    r2StorageBytes: 100_000_000, r2ClassAOperations: 1_000, workflowExecutions: 1_000, workflowSteps: 1_000, workflowStorageBytes: 1_000_000,
    doRequests: 1_000, doRowsRead: 1_000, doRowsWritten: 1_000, logEvents: 100_000 };
  const owner = { schemaVersion: 1, policyId: 'session-policy', revision: 1, deploymentId: 'session-deployment', mode: 'conservative',
    catalogueVersion: 'synthetic-2026-09', maxGrantLifetimeMs: 60_000,
    budgets: Object.entries(limits).map(([dimension, limit]) => ({ dimension, limit, allocationId: `session-${dimension}`, recoveryPercent: 20,
      provenance: 'owner-allocation', window: dimension.endsWith('StorageBytes') ? { kind: 'stock', id: `session-${dimension}-stock` }
        : { kind: 'interval', id: 'session-window', startsAt: NOW - 1, endsAt: NOW + 3_600_000 } })) };
  await db.batch([
    db.prepare("INSERT INTO budget_deployment_authority VALUES ('session-deployment',1,'active',?)").bind(NOW),
    db.prepare(`INSERT INTO budget_owner_policies (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES ('session-deployment','session-policy',1,1,'session-aggregate',64,30000,?)`).bind(JSON.stringify(owner)),
  ]);
  for (const tenantId of ['tenant-a', 'tenant-b']) {
    const restriction = { schemaVersion: 1, tenantId, ownerPolicyId: 'session-policy', ownerPolicyRevision: 1, revision: 1, mode: 'conservative', limits, disabledFeatures: [] };
    await db.batch([
      db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'shared-actor',?,'agent',1,1)").bind(tenantId, `${tenantId}@example.test`),
      db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES (?,'shared-group','Synthetic group')").bind(tenantId),
      db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES (?,'shared-actor','shared-group')").bind(tenantId),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES (?,'shared-ticket','Synthetic','customer@example.test','shared-group','dashboard')").bind(tenantId),
      db.prepare(`INSERT INTO budget_tenant_allocations (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
        VALUES ('session-deployment',?,'session-policy',1,1,?,?,'active')`).bind(tenantId, `session-${tenantId}`, JSON.stringify(restriction)),
      db.prepare("INSERT INTO tenant_role_capability_policies (tenant_id,role,capability,enabled,revision) VALUES (?,'agent','ticket-fields.manage',1,1)").bind(tenantId),
    ]);
  }
  await db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES ('tenant-b','only-b','Synthetic B','customer@example.test','shared-group','dashboard')").run();
  const writeMeter = meterNativeD1Writes(db);
  const meteredDb = writeMeter.database;
  const rawNamespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
  const coordinator = rawNamespace.get(rawNamespace.idFromName('session-aggregate')) as unknown as BudgetCoordinatorDO;
  const calls = { refresh: 0, reserve: 0 };
  let loseAck = false;
  const namespace = {
    idFromName: (name: string) => rawNamespace.idFromName(name),
    get: () => ({
      refreshFromTrustedAuthority: async (value: Parameters<BudgetCoordinatorDO['refreshFromTrustedAuthority']>[0]) => { calls.refresh++; return coordinator.refreshFromTrustedAuthority(value); },
      reserveFromTrustedAuthority: async (value: Parameters<BudgetCoordinatorDO['reserveFromTrustedAuthority']>[0]) => {
        calls.reserve++; const outcome = await coordinator.reserveFromTrustedAuthority(value);
        if (loseAck && outcome.status === 'granted') { loseAck = false; throw new Error('synthetic lost committed grant reply'); }
        return outcome;
      },
    }),
  } as unknown as DurableObjectNamespace;
  const cache = new IsolateBudgetAdmissionCache();
  const service = new SessionBudgetAdmissionService(cache);
  const scopeFor = (tenantId: string) => createVerifiedTenantScope(tenantId, 'shared-actor', ['agent'], 1);
  const credentialFor = (tenantId: string): SessionBudgetCredential => ({ tenantId, actorId: 'shared-actor', role: 'agent', sessionVersion: 1, expiresAt: NOW / 1000 + 60, mfaVerified: true });
  const requirements: SessionBudgetRequirements = { ticket: { id: 'shared-ticket', groupId: 'shared-group' } };
  const admit = (operation: string, tenantId = 'tenant-a', credential = credentialFor(tenantId), needed = requirements) => {
    const scope = scopeFor(tenantId);
    return service.admit({ repository: new BudgetAuthorityRepository(meteredDb, scope), sessions: new SessionBudgetAuthorityRepository(meteredDb, scope),
      namespace, scope, credential, requirements: needed, now: () => NOW,
      intent: { operationId: operation, operationFingerprint: `digest:${operation}`, workScopeKey: 'synthetic-ticket-work' },
      business: { d1RowsRead: 2_560, d1RowsWritten: 1, logEvents: 136 } });
  };
  return { mf, db:meteredDb, coordinator, calls, cache, admit, scopeFor, credentialFor, requirements, namespace, writeMeter,
    loseAck: () => { loseAck = true; } };
  } catch (error) { await mf.dispose(); throw error; }
}

test('live session adapter shares warm grants for one authorized scope and isolates colliding tenant/actor/ticket IDs', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.admit('same-operation')).status, 'spent');
    const cold = { ...f.calls };
    assert.equal((await f.admit('second-operation')).status, 'spent');
    assert.equal((await f.admit('second-operation')).status, 'idempotent');
    assert.equal((await f.admit('second-operation')).reason, 'replay-exhausted');
    assert.deepEqual(f.calls, cold, 'all warm spends and bounded replays make zero budget DO calls');
    assert.equal((await f.admit('same-operation', 'tenant-b')).status, 'spent');
    const states = (await f.coordinator.inspectForTrustedRuntime()).tenantStates;
    assert.equal(states.find(state => state.tenantId === 'tenant-a')?.grants.length, 1);
    assert.equal(states.find(state => state.tenantId === 'tenant-b')?.grants.length, 1);
    assert.equal(f.cache.inspectForTrustedRuntime().operations, 3);
  } finally { await f.mf.dispose(); }
});

test('session tenant/actor/role/MFA/expiry and wrong-target failures have no admission side effects', async () => {
  const f = await fixture();
  try {
    const credential = f.credentialFor('tenant-a');
    for (const changed of [
      { ...credential, tenantId: 'tenant-b' }, { ...credential, actorId: 'missing' }, { ...credential, role: 'admin' as const },
      { ...credential, sessionVersion: 0 }, { ...credential, expiresAt: NOW / 1000 }, { ...credential, mfaVerified: false },
    ]) assert.equal((await f.admit('denied', 'tenant-a', changed)).status, 'rejected');
    assert.equal((await f.admit('foreign', 'tenant-a', credential, { ticket: { id: 'only-b', groupId: 'shared-group' } })).status, 'rejected');
    assert.equal((await f.admit('wrong-group', 'tenant-a', credential, { ticket: { id: 'shared-ticket', groupId: null } })).status, 'rejected');
    assert.deepEqual(f.calls, { refresh: 0, reserve: 0 });
    assert.equal(f.cache.inspectForTrustedRuntime().operations, 0);
    assert.equal((await f.db.prepare('SELECT count(*) AS count FROM tickets').first<{ count: number }>())?.count, 3);
    assert.equal((await f.db.prepare('SELECT count(*) AS count FROM articles').first<{ count: number }>())?.count, 0);
  } finally { await f.mf.dispose(); }
});

test('staff read authority resolves the current target group before a warm grant can expose ticket content', async () => {
  const f = await fixture();
  try {
    const read = { readTicketId: 'shared-ticket' };
    assert.equal((await f.admit('read-before-change', 'tenant-a', f.credentialFor('tenant-a'), read)).status, 'spent');
    const before = { ...f.calls };
    await f.db.batch([
      f.db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES ('tenant-a','moved-group','Moved')"),
      f.db.prepare("UPDATE tickets SET group_id='moved-group' WHERE tenant_id='tenant-a' AND id='shared-ticket'"),
    ]);
    assert.equal((await f.admit('read-after-group-change', 'tenant-a', f.credentialFor('tenant-a'), read)).status, 'rejected');
    assert.deepEqual(f.calls, before, 'current group denial consumes no further coordinator work');
    assert.equal((await f.admit('read-tenant-b', 'tenant-b', f.credentialFor('tenant-b'), read)).status, 'spent');
  } finally { await f.mf.dispose(); }
});

for (const [label, mutation] of [
  ["session revocation", "UPDATE users SET session_version=2 WHERE tenant_id='tenant-a' AND id='shared-actor'"],
  ["role change", "UPDATE users SET role='customer' WHERE tenant_id='tenant-a' AND id='shared-actor'"],
  ["MFA disable", "UPDATE users SET mfa_enabled=0 WHERE tenant_id='tenant-a' AND id='shared-actor'"],
  ["group membership removal", "DELETE FROM user_groups WHERE tenant_id='tenant-a' AND user_id='shared-actor' AND group_id='shared-group'"],
] as const) test(`live session changes reject a previously warm grant: ${label}`, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.admit('before-change')).status, 'spent');
    const before = { ...f.calls };
    await f.db.prepare(mutation).run();
    assert.equal((await f.admit('after-change')).status, 'rejected');
    assert.deepEqual(f.calls, before);
    assert.equal(f.cache.inspectForTrustedRuntime().operations, 1);
    assert.equal((await f.admit('unaffected-other-tenant', 'tenant-b')).status, 'spent');
  } finally { await f.mf.dispose(); }
});

test('knowledge source admission rejects a newly revoked current staff session before R2 or workflow composition', async () => {
  const f = await fixture();
  try {
    const scope = f.scopeFor('tenant-a');
    const deps = { database: f.db, scope, repositories: { budgetAuthority: new BudgetAuthorityRepository(f.db, scope) } } as any;
    const payload = { sub: 'shared-actor', role: 'agent' as const, tenant_id: 'tenant-a', session_version: 1,
      mfa_verified: true, exp: NOW / 1000 + 60, email: 'tenant-a@example.test', iat: NOW / 1000 };
    const env = { BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', BUDGET_COORDINATOR_DO: f.namespace } as any;
    assert.equal((await admitKnowledgeSourceWrite({ env, deps, payload, sourceBytes: 1_024, sourceKind: 'article', now: () => NOW })).status, 'admitted');
    const before = { ...f.calls };
    await f.db.prepare("UPDATE users SET session_version=2 WHERE tenant_id='tenant-a' AND id='shared-actor'").run();
    assert.equal((await admitKnowledgeSourceWrite({ env, deps, payload, sourceBytes: 1_024, sourceKind: 'article', now: () => NOW })).status, 'rejected');
    assert.deepEqual(f.calls, before, 'revocation is rejected before a source write can be composed');
  } finally { await f.mf.dispose(); }
});

for (const [label, mutation] of [
  ['revoked staff session', "UPDATE users SET session_version=2 WHERE tenant_id='tenant-a' AND id='shared-actor'"],
] as const) test(`knowledge source commit rejects ${label} after admission with no source side effect`,async()=>{
  const f=await fixture(); try {
    const bucket=(await f.mf.getR2Bucket('ATTACHMENTS_BUCKET') as unknown as R2Bucket);
    const scope=f.scopeFor('tenant-a');
    const deps=createTenantRequestDeps(scope,{DB:f.db,ATTACHMENTS_BUCKET:bucket,VECTOR_INDEX:{upsert:async()=>undefined},JWT_SECRET:'synthetic-test-secret'});
    const payload={sub:'shared-actor',role:'agent' as const,tenant_id:'tenant-a',session_version:1,mfa_verified:true,
      exp:NOW/1000+60,email:'tenant-a@example.test',iat:NOW/1000};
    const admission=await admitKnowledgeSourceWrite({env:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',BUDGET_COORDINATOR_DO:f.namespace} as any,
      deps,payload,sourceBytes:12,sourceKind:'article',now:()=>NOW});
    assert.equal(admission.status,'admitted');
    await f.db.prepare(mutation).run();
    const service=new TenantKnowledgeService(deps,{generateEmbeddings:async()=>Array.from({length:1024},()=>0)} as any);
    await assert.rejects(service.uploadAndProcess('Denied','source.txt',new TextEncoder().encode('source bytes'),'text/plain',undefined,undefined,admission));
    assert.equal((await f.db.prepare("SELECT count(*) count FROM knowledge_docs WHERE tenant_id='tenant-a'").first<{count:number}>())?.count,0);
    assert.equal((await f.db.prepare("SELECT count(*) count FROM knowledge_index_versions WHERE tenant_id='tenant-a'").first<{count:number}>())?.count,0);
    assert.equal((await bucket.list()).objects.length,0);
  } finally {await f.mf.dispose();}
});

test('article update rejects an owner policy edit after admission without changing metadata or storage',async()=>{
  const f=await fixture(); try {
    const bucket=(await f.mf.getR2Bucket('ATTACHMENTS_BUCKET') as unknown as R2Bucket),scope=f.scopeFor('tenant-a');
    const deps=createTenantRequestDeps(scope,{DB:f.db,ATTACHMENTS_BUCKET:bucket,VECTOR_INDEX:{upsert:async()=>undefined},JWT_SECRET:'synthetic-test-secret'});
    await deps.repositories.knowledge.createDocument({id:'existing-doc',title:'Original',file_path:'knowledge/existing-doc/original',tier:'answer'});
    const payload={sub:'shared-actor',role:'agent' as const,tenant_id:'tenant-a',session_version:1,mfa_verified:true,
      exp:NOW/1000+60,email:'tenant-a@example.test',iat:NOW/1000};
    const admission=await admitKnowledgeSourceWrite({env:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',BUDGET_COORDINATOR_DO:f.namespace} as any,
      deps,payload,sourceBytes:12,sourceKind:'article',now:()=>NOW});
    assert.equal(admission.status,'admitted');
    await f.db.prepare("UPDATE budget_owner_policies SET policy_json=policy_json||' ' WHERE deployment_id='session-deployment' AND policy_id='session-policy'").run();
    const service=new TenantKnowledgeService(deps,{generateEmbeddings:async()=>Array.from({length:1024},()=>0)} as any);
    await assert.rejects(service.updateArticle('existing-doc','Changed','source bytes',null,'answer',admission));
    assert.deepEqual(await f.db.prepare("SELECT title,file_path FROM knowledge_docs WHERE tenant_id='tenant-a' AND id='existing-doc'").first(),
      {title:'Original',file_path:'knowledge/existing-doc/original'});
    assert.equal((await f.db.prepare("SELECT count(*) count FROM knowledge_index_versions WHERE tenant_id='tenant-a'").first<{count:number}>())?.count,0);
    assert.equal((await bucket.list()).objects.length,0);
  } finally {await f.mf.dispose();}
});

test('knowledge source upload publishes one immutable source within its whole-attempt D1 write envelope',async t=>{
  const f=await fixture(); try {
    const bucket=(await f.mf.getR2Bucket('ATTACHMENTS_BUCKET') as unknown as R2Bucket),scope=f.scopeFor('tenant-a');
    const deps=createTenantRequestDeps(scope,{DB:f.db,ATTACHMENTS_BUCKET:bucket,VECTOR_INDEX:{upsert:async()=>undefined},JWT_SECRET:'synthetic-test-secret'});
    const payload={sub:'shared-actor',role:'agent' as const,tenant_id:'tenant-a',session_version:1,mfa_verified:true,
      exp:NOW/1000+60,email:'tenant-a@example.test',iat:NOW/1000};
    const admission=await admitKnowledgeSourceWrite({env:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',BUDGET_COORDINATOR_DO:f.namespace} as any,
      deps,payload,sourceBytes:12,sourceKind:'document',now:()=>NOW});
    assert.equal(admission.status,'admitted');
    f.writeMeter.reset();
    const id=await new TenantKnowledgeService(deps,{generateEmbeddings:async()=>Array.from({length:1024},()=>0)} as any)
      .uploadAndProcess('Admitted','source.txt',new TextEncoder().encode('source bytes'),'text/plain',undefined,'answer',admission);
    const attemptRows=f.writeMeter.rowsWritten();
    t.diagnostic(`native D1 rows_written for successful upload attempt: ${attemptRows} ${JSON.stringify(f.writeMeter.samples())}`);
    assert.equal(attemptRows,24,'upload native D1 metadata changed');
    assert.ok(attemptRows<=(KNOWLEDGE_SOURCE_WRITE_ENVELOPES.document.d1RowsWritten ?? 0),
      `upload wrote ${attemptRows} rows against ${KNOWLEDGE_SOURCE_WRITE_ENVELOPES.document.d1RowsWritten}`);
    const document=await deps.repositories.knowledge.getDocument(id); assert.ok(document); assert.match(document.file_path,/\/versions\/1$/);
    assert.ok(await deps.attachmentStorage.getAttachment(document.file_path));
    assert.equal((await f.db.prepare("SELECT count(*) count FROM knowledge_index_versions WHERE tenant_id='tenant-a' AND document_id=? AND state='preparing'").bind(id).first<{count:number}>())?.count,1);
    assert.equal((await f.db.prepare("SELECT count(*) count FROM budget_grant_operations WHERE tenant_id='tenant-a'").first<{count:number}>())?.count,1);
  } finally {await f.mf.dispose();}
});

test('article update publishes within its whole-attempt D1 write envelope',async t=>{
  const f=await fixture(); try {
    const bucket=(await f.mf.getR2Bucket('ATTACHMENTS_BUCKET') as unknown as R2Bucket),scope=f.scopeFor('tenant-a');
    const deps=createTenantRequestDeps(scope,{DB:f.db,ATTACHMENTS_BUCKET:bucket,VECTOR_INDEX:{upsert:async()=>undefined},JWT_SECRET:'synthetic-test-secret'});
    await deps.repositories.knowledge.createDocument({id:'updated-doc',title:'Original',file_path:'knowledge/updated-doc/original',tier:'answer'});
    const payload={sub:'shared-actor',role:'agent' as const,tenant_id:'tenant-a',session_version:1,mfa_verified:true,
      exp:NOW/1000+60,email:'tenant-a@example.test',iat:NOW/1000};
    const admission=await admitKnowledgeSourceWrite({env:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',BUDGET_COORDINATOR_DO:f.namespace} as any,
      deps,payload,sourceBytes:12,sourceKind:'article',now:()=>NOW});
    assert.equal(admission.status,'admitted');
    f.writeMeter.reset();
    await new TenantKnowledgeService(deps,{generateEmbeddings:async()=>Array.from({length:1024},()=>0)} as any)
      .updateArticle('updated-doc','Updated','source bytes',null,'answer',admission);
    const attemptRows=f.writeMeter.rowsWritten();
    t.diagnostic(`native D1 rows_written for successful article update attempt: ${attemptRows} ${JSON.stringify(f.writeMeter.samples())}`);
    assert.equal(attemptRows,23,'article update native D1 metadata changed');
    assert.ok(attemptRows<=(KNOWLEDGE_SOURCE_WRITE_ENVELOPES.article.d1RowsWritten ?? 0),
      `article update wrote ${attemptRows} rows against ${KNOWLEDGE_SOURCE_WRITE_ENVELOPES.article.d1RowsWritten}`);
    assert.deepEqual(await f.db.prepare("SELECT title,status FROM knowledge_docs WHERE tenant_id='tenant-a' AND id='updated-doc'").first(),
      {title:'Updated',status:'pending'});
  } finally {await f.mf.dispose();}
});

test('QA staging carries the admitted fence through the retention claim, R2 source and article publication',async t=>{
  const f=await fixture(); try {
    await f.db.batch([
      f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES ('tenant-a','qa-ticket','QA','customer@example.test','dashboard')"),
      f.db.prepare("INSERT INTO articles (tenant_id,id,ticket_id,sender_type,body,is_internal,intake_source) VALUES ('tenant-a','qa-article','qa-ticket','agent','qa source',0,'dashboard')"),
    ]);
    const bucket=(await f.mf.getR2Bucket('ATTACHMENTS_BUCKET') as unknown as R2Bucket),scope=f.scopeFor('tenant-a');
    const deps=createTenantRequestDeps(scope,{DB:f.db,ATTACHMENTS_BUCKET:bucket,VECTOR_INDEX:{upsert:async()=>undefined},JWT_SECRET:'synthetic-test-secret'});
    const payload={sub:'shared-actor',role:'agent' as const,tenant_id:'tenant-a',session_version:1,mfa_verified:true,
      exp:NOW/1000+60,email:'tenant-a@example.test',iat:NOW/1000};
    const admission=await admitKnowledgeSourceWrite({env:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',BUDGET_COORDINATOR_DO:f.namespace} as any,
      deps,payload,sourceBytes:10*1024*1024,sourceKind:'qa',now:()=>NOW});
    assert.equal(admission.status,'admitted');
    f.writeMeter.reset();
    await new TenantKnowledgeService(deps,{generateEmbeddings:async()=>Array.from({length:1024},()=>0)} as any)
      .markArticleAsQA('qa-article','answer',admission);
    const attemptRows=f.writeMeter.rowsWritten();
    t.diagnostic(`native D1 rows_written for successful QA attempt: ${attemptRows} ${JSON.stringify(f.writeMeter.samples())}`);
    assert.equal(attemptRows,21,'QA native D1 metadata changed');
    assert.ok(attemptRows<=(KNOWLEDGE_SOURCE_WRITE_ENVELOPES.qa.d1RowsWritten ?? 0),
      `QA staging wrote ${attemptRows} rows against ${KNOWLEDGE_SOURCE_WRITE_ENVELOPES.qa.d1RowsWritten}`);
    assert.deepEqual(await f.db.prepare("SELECT qa_type,chunk_count FROM articles WHERE tenant_id='tenant-a' AND id='qa-article'").first(),{qa_type:'answer',chunk_count:0});
    const version=await f.db.prepare("SELECT file_path,state FROM knowledge_index_versions WHERE tenant_id='tenant-a' AND document_id='qa-article'").first<{file_path:string;state:string}>();
    assert.equal(version?.state,'preparing'); assert.ok(version && await deps.attachmentStorage.getAttachment(version.file_path));
    assert.equal((await f.db.prepare("SELECT count(*) count FROM ticket_cleanup_claims WHERE tenant_id='tenant-a' AND ticket_id='qa-ticket'").first<{count:number}>())?.count,0);
    assert.equal((await f.db.prepare("SELECT count(*) count FROM budget_grant_operations WHERE tenant_id='tenant-a'").first<{count:number}>())?.count,1);
  } finally {await f.mf.dispose();}
});

test('failed source recovery remains within the whole-attempt D1 write envelope',async t=>{
  const f=await fixture(); try {
    const rawBucket=(await f.mf.getR2Bucket('ATTACHMENTS_BUCKET') as unknown as R2Bucket),scope=f.scopeFor('tenant-a');
    const failingBucket={get:rawBucket.get.bind(rawBucket),delete:rawBucket.delete.bind(rawBucket),
      put:async()=>{throw new Error('synthetic R2 source failure');}};
    const deps=createTenantRequestDeps(scope,{DB:f.db,ATTACHMENTS_BUCKET:failingBucket,VECTOR_INDEX:{upsert:async()=>undefined},JWT_SECRET:'synthetic-test-secret'});
    const payload={sub:'shared-actor',role:'agent' as const,tenant_id:'tenant-a',session_version:1,mfa_verified:true,
      exp:NOW/1000+60,email:'tenant-a@example.test',iat:NOW/1000};
    const admission=await admitKnowledgeSourceWrite({env:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',BUDGET_COORDINATOR_DO:f.namespace} as any,
      deps,payload,sourceBytes:12,sourceKind:'document',now:()=>NOW});
    assert.equal(admission.status,'admitted');
    f.writeMeter.reset();
    await assert.rejects(new TenantKnowledgeService(deps,{generateEmbeddings:async()=>Array.from({length:1024},()=>0)} as any)
      .uploadAndProcess('Failed','source.txt',new TextEncoder().encode('source bytes'),'text/plain',undefined,'answer',admission));
    const attemptRows=f.writeMeter.rowsWritten();
    t.diagnostic(`native D1 rows_written for failed source recovery attempt: ${attemptRows} ${JSON.stringify(f.writeMeter.samples())}`);
    assert.equal(attemptRows,19,'failed source recovery native D1 metadata changed');
    assert.ok(attemptRows<=(KNOWLEDGE_SOURCE_WRITE_ENVELOPES.document.d1RowsWritten ?? 0),
      `failed source recovery wrote ${attemptRows} rows against ${KNOWLEDGE_SOURCE_WRITE_ENVELOPES.document.d1RowsWritten}`);
    assert.deepEqual(await f.db.prepare("SELECT v.state,j.state AS job_state FROM knowledge_index_versions v JOIN knowledge_index_jobs j ON j.tenant_id=v.tenant_id AND j.document_id=v.document_id AND j.version=v.version WHERE v.tenant_id='tenant-a'").first(),
      {state:'failed',job_state:'failed_cleanup'});
    assert.equal((await f.db.prepare("SELECT count(*) count FROM budget_grant_operations WHERE tenant_id='tenant-a'").first<{count:number}>())?.count,1);
  } finally {await f.mf.dispose();}
});

test('existing capability fences match the current owner/role/tenant/group contract and reject changed policy', async () => {
  const f = await fixture();
  try {
    const principal = { tenantId: 'tenant-a', actorId: 'shared-actor', role: 'agent', sessionVersion: 1 };
    const policy = new CapabilityPolicyService(f.db, f.scopeFor('tenant-a'));
    const decision = await policy.authorize(principal, 'ticket-fields.manage');
    assert.equal(decision.allowed, true);
    const needed = { ...f.requirements, capability: { ...principal, capability: decision.capability, policyFingerprint: decision.policyFingerprint } };
    assert.equal((await f.admit('capability-first', 'tenant-a', f.credentialFor('tenant-a'), needed)).status, 'spent');
    assert.equal((await f.admit('capability-warm', 'tenant-a', f.credentialFor('tenant-a'), needed)).status, 'spent');
    const before = { ...f.calls };
    await f.db.prepare(`INSERT INTO tenant_group_capability_constraints (tenant_id,group_id,capability,enabled,revision)
      VALUES ('tenant-a','shared-group','ticket-fields.manage',0,1)`).run();
    assert.equal((await f.admit('capability-denied', 'tenant-a', f.credentialFor('tenant-a'), needed)).status, 'rejected');
    assert.deepEqual(f.calls, before);
  } finally { await f.mf.dispose(); }
});

test('session capability membership reads stop at a 65-row sentinel and use tenant/user index lookup', async () => {
  const f = await fixture();
  try {
    const ids = Array.from({ length: 64 }, (_, index) => `bounded-group-${String(index).padStart(2, '0')}`);
    await f.db.batch(ids.flatMap(id => [
      f.db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES ('tenant-a',?,?)").bind(id, id),
      f.db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('tenant-a','shared-actor',?)").bind(id),
    ]));
    const principal = { tenantId: 'tenant-a', actorId: 'shared-actor', role: 'agent', sessionVersion: 1 };
    const decision = await new CapabilityPolicyService(f.db, f.scopeFor('tenant-a')).authorize(principal, 'ticket-fields.manage');
    assert.equal(decision.allowed, true, 'the existing capability remains permitted; the budget adapter applies its finite-work bound');
    const needed = { ...f.requirements, capability: { ...principal, capability: decision.capability, policyFingerprint: decision.policyFingerprint } };
    assert.equal((await f.admit('too-many-groups', 'tenant-a', f.credentialFor('tenant-a'), needed)).status, 'rejected');
    const plan = await f.db.prepare(`EXPLAIN QUERY PLAN ${SESSION_BUDGET_GROUP_CAPABILITY_SQL}`)
      .bind('tenant-a', 'shared-actor', 'tenant-a', 'ticket-fields.manage').all<{ detail: string }>();
    assert.ok(plan.results.some((row: { detail: string }) => /SEARCH user_groups USING COVERING INDEX/.test(row.detail) && /tenant_id=\? AND user_id=\?/.test(row.detail)));
    assert.ok(plan.results.some((row: { detail: string }) => /SEARCH constraint_row USING INDEX/.test(row.detail) && /tenant_id=\? AND group_id=\? AND capability=\?/.test(row.detail)));
    assert.deepEqual(f.calls, { refresh: 0, reserve: 0 });
  } finally { await f.mf.dispose(); }
});

test('session adapter keeps finite cold retry and quota rejection before further accepted work', async () => {
  const f = await fixture(3);
  try {
    f.loseAck();
    assert.equal((await f.admit('only-capacity')).status, 'spent');
    assert.deepEqual(f.calls, { refresh: 2, reserve: 2 });
    const first = (await f.coordinator.inspectForTrustedRuntime()).tenantStates.find(state => state.tenantId === 'tenant-a')!.grants;
    assert.equal(first.length, 1); assert.equal(first[0].holderSeedAttempts, 2);
    assert.equal((await f.admit('exhausted')).reason, 'exhausted');
    assert.equal(f.cache.inspectForTrustedRuntime().operations, 1);
  } finally { await f.mf.dispose(); }
});


test('session warm admission retires an exact same-revision source edit without affecting another tenant',async()=>{
  const f=await fixture();try{
    assert.equal((await f.admit('original')).status,'spent');
    assert.equal((await f.admit('original','tenant-b')).status,'spent');
    const calls={...f.calls};
    const original=(await f.db.prepare("SELECT restriction_json FROM budget_tenant_allocations WHERE tenant_id='tenant-a'").first<{restriction_json:string}>())!.restriction_json;
    const before=await f.coordinator.inspectForTrustedRuntime();
    await f.db.prepare("UPDATE budget_tenant_allocations SET restriction_json=restriction_json||' ' WHERE tenant_id='tenant-a'").run();
    assert.equal((await f.admit('changed')).reason,'stale-policy');
    assert.equal((await f.admit('still-current','tenant-b')).status,'spent');
    assert.deepEqual(f.calls,calls,'current session checks and snapshot comparison add no warm DO calls');
    assert.equal((await f.admit('changed')).status,'spent','valid current source can allocate a newly charged holder');
    assert.deepEqual(f.calls,{refresh:calls.refresh+1,reserve:calls.reserve+1});
    await f.db.prepare("UPDATE budget_tenant_allocations SET restriction_json=? WHERE tenant_id='tenant-a'").bind(original).run();
    assert.equal((await f.admit('restored')).reason,'stale-policy');
    assert.equal((await f.admit('restored')).status,'spent','restored source also needs a new paid holder');
    const after=(await f.coordinator.inspectForTrustedRuntime()).tenantStates;
    const prior=before.tenantStates.find(state=>state.tenantId==='tenant-a')!.grants[0];
    const current=after.find(state=>state.tenantId==='tenant-a')!.grants;
    assert.equal(current.length,3);assert.equal(new Set(current.map(grant=>grant.holderId)).size,3);
    assert.deepEqual(current.find(grant=>grant.holderId===prior.holderId)?.accounted,prior.accounted);
    assert.deepEqual(after.find(state=>state.tenantId==='tenant-b'),before.tenantStates.find(state=>state.tenantId==='tenant-b'));
  }finally{await f.mf.dispose();}
});
