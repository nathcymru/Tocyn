import { encodeCoordinatorState } from '../src/budgets/coordinator-storage';
import { CANONICAL_MUTATION_ATTEMPT_D1_WRITES, CANONICAL_MUTATION_D1_WRITES } from '../src/budgets/canonical-mutation-envelope';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { BudgetAuthorityRepository } from '../src/repositories/budget-authority.repository';
import { BudgetGrantClosureRepository } from '../src/repositories/budget-grant-closure.repository';
import { BudgetGrantRecoveryService } from '../src/budgets/budget-grant-recovery.service';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { canonicalMutationJson } from '../src/services/ticket-mutation-replay.service';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
import type { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';

const serverRoot = resolve(import.meta.dirname, '..');
const now = Date.now();
// Opaque 256-bit machine credentials, never passwords or reusable fixture secrets.
const apiKey = `lt_budget_runtime.${randomBytes(32).toString('hex')}`;

async function credentialDigest(value: string): Promise<string> {
  // Match ApiAuthResolver's Web Crypto protocol for high-entropy API tokens.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('hex');
}

async function customerToken(secret: string, tenantId: string, email: string, sessionVersion: number): Promise<string> {
  return new SignJWT({ sub: 'runtime-customer', role: 'customer', tenant_id: tenantId, email, session_version: sessionVersion })
    .setProtectedHeader({ alg: 'HS256' }).setAudience('widget').setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

async function applyMigrations(db: D1Database, through?: string): Promise<void> {
  const directory = join(serverRoot, 'migrations');
  for (const file of readdirSync(directory).filter(file => file.endsWith('.sql')).sort()) {
    await db.batch(splitSql(readFileSync(join(directory, file), 'utf8')).map(statement => db.prepare(statement)));
    if (file === through) break;
  }
}

function policy(overrides: Partial<Record<string, number>> = {}) {
  // These are the complete active ticket-operation dimensions. Keeping the
  // authority snapshot to this bounded set also exercises its real RPC cap.
  const dimensions = ['workerRequests', 'd1RowsRead', 'd1RowsWritten', 'r2ClassBOperations',
    'doRequests', 'doRowsRead', 'doRowsWritten', 'logEvents'] as const;
  const limits: Record<string, number> = Object.fromEntries(dimensions.map(dimension => [dimension, 1_000_000]));
  Object.assign(limits, { workerRequests: 3, d1RowsRead: 8_000, d1RowsWritten: 4_000, doRequests: 10, doRowsWritten: 10, doRowsRead: 10, logEvents: 200 }, overrides);
  return {
    schemaVersion: 1, policyId: 'runtime-owner-policy', revision: 1, deploymentId: 'runtime-deployment',
    mode: 'conservative', catalogueVersion: 'runtime-catalogue', maxGrantLifetimeMs: 60_000,
    budgets: dimensions.map(dimension => ({ dimension, allocationId: `runtime-${dimension}`,
      window: { kind: 'interval', id: 'runtime-window', startsAt: Date.now() - 1_000, endsAt: Date.now() + 60_000 },
      limit: limits[dimension], recoveryPercent: 20, provenance: 'owner-allocation' as const })),
  };
}

async function seed(db: D1Database, extraTenants = 31, owner = policy()): Promise<void> {
  const tenantId = 'runtime-tenant';
  const keyHash = await credentialDigest(apiKey);
  const restriction = { schemaVersion: 1, tenantId, ownerPolicyId: owner.policyId, ownerPolicyRevision: 1,
    revision: 1, mode: 'conservative', limits: Object.fromEntries(owner.budgets.map(item => [item.dimension, item.limit])), disabledFeatures: [] };
  await db.batch([
    db.prepare(`INSERT INTO api_keys (tenant_id,id,name,key_hash,prefix,permissions,is_active,created_at)
      VALUES (?,?,?,?,?,'tickets:write',1,unixepoch())`).bind(tenantId, 'runtime-key', 'runtime key', keyHash, 'lt_budget'),
    db.prepare(`INSERT INTO budget_deployment_authority (deployment_id,authority_revision,state,updated_at)
      VALUES ('runtime-deployment',1,'active',?)`).bind(now),
    db.prepare(`INSERT INTO budget_owner_policies
      (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES ('runtime-deployment','runtime-owner-policy',1,1,'runtime-owner-coordinator',64,?,?)`).bind(Math.min(owner.maxGrantLifetimeMs,60_000), JSON.stringify(owner)),
    db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES ('runtime-deployment',?,'runtime-owner-policy',1,1,'runtime-namespace',?,'active')`).bind(tenantId, JSON.stringify(restriction)),
    db.prepare(`INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled)
      VALUES (?,'runtime-staff','runtime-staff@example.test','agent',1,1)`).bind(tenantId),
  ]);
  // Exercise an enabled multi-tenant authority below the serialized RPC cap;
  // the separate authority test covers the 128-allocation sentinel and plan.
  const extraAllocationStatements = Array.from({ length: extraTenants }, (_, index) => {
    const extraTenant = `runtime-extra-${String(index).padStart(3, '0')}`;
    const extraRestriction = { ...restriction, tenantId: extraTenant };
    return db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES ('runtime-deployment',?,'runtime-owner-policy',1,1,?,?,'active')`)
      .bind(extraTenant, `runtime-namespace-${index}`, JSON.stringify(extraRestriction));
  });
  if (extraAllocationStatements.length > 0) await db.batch(extraAllocationStatements);
}

test('real local API-key create reserves configured aggregate capacity before its mutation commit', async () => {
  const bundled = await build({ entryPoints: [resolve(import.meta.dirname, 'budget-admission-runtime-entry.ts')], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'budget-admission-proof', modules: true, compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
      bindings: { BUDGET_ADMISSION_POLICY: 'api-ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true' },
      d1Databases: { DB: 'budget-admission-d1' },
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' },
      unsafeEphemeralDurableObjects: true,
    }] }));
    const db = await mf.getD1Database('DB');
    await applyMigrations(db);
    await seed(db);
    const snapshot = await new BudgetAuthorityRepository(db).resolveForVerifiedPrincipal(
      createVerifiedTenantScope('runtime-tenant', 'runtime-key', ['integration'], 1),
      { kind: 'api-key', apiKeyId: 'runtime-key', requiredPermission: 'tickets:write' }, now,
    );
    assert.equal(snapshot.kind, 'active');
    if (snapshot.kind !== 'active') throw new Error('expected active synthetic authority');
    assert.equal(snapshot.authority.tenantAllocations.length, 32);
    const coordinatorNamespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const coordinator = coordinatorNamespace.get(coordinatorNamespace.idFromName(snapshot.authority.aggregateId)) as unknown as BudgetCoordinatorDO;
    await coordinator.refreshFromTrustedAuthority(snapshot.authority);
    const request = () => mf!.dispatchFetch('http://runtime.test/api/v1/tickets', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ subject: 'Budgeted runtime ticket', customer_email: 'runtime@example.test', body: 'synthetic' }),
    });
    const accepted = await request();
    assert.equal(accepted.status, 201);
    const acceptedBody = await accepted.json() as { id: string };
    const rejected = await request();
    assert.equal(rejected.status, 429);
    assert.deepEqual(await rejected.json(), { code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' });
    const reply = await mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${acceptedBody.id}/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify({ body: 'must not commit' }),
    });
    assert.equal(reply.status, 429, 'the reply route uses the same configured admission boundary');
    await reply.body?.cancel();
    const tickets = await db.prepare("SELECT count(*) AS count FROM tickets WHERE tenant_id='runtime-tenant'").first<{ count: number }>();
    const articles = await db.prepare("SELECT count(*) AS count FROM articles WHERE tenant_id='runtime-tenant'").first<{ count: number }>();
    assert.equal(tickets?.count, 1, 'budget rejection occurs before the second ticket mutation batch');
    assert.equal(articles?.count, 1, 'budget rejection occurs before the reply mutation batch');
  } finally {
    await mf?.dispose();
  }
});

test('real local combined policy admits API, staff, portal and widget mutations with customer receipts and current session fences', async () => {
  const bundled = await build({ entryPoints: [resolve(import.meta.dirname, 'budget-admission-runtime-entry.ts')], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  const jwtSecret = 'synthetic-runtime-staff-secret-at-least-32-chars';
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'combined-ticket-admission-proof', modules: true, compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
      bindings: { BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true', ENVIRONMENT: 'local', JWT_SECRET: jwtSecret },
      d1Databases: { DB: 'combined-ticket-admission-d1' },
      r2Buckets: { ATTACHMENTS_BUCKET: 'combined-ticket-admission-r2' },
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO', NOTIFICATION_DO: 'NotificationDO' },
      unsafeEphemeralDurableObjects: true,
    }] }));
    const db = await mf.getD1Database('DB');
    await applyMigrations(db);
    await seed(db, 0, policy({ workerRequests: 10_000_000, d1RowsRead: 10_000_000, d1RowsWritten: 10_000_000,
      doRequests: 10_000_000, doRowsRead: 10_000_000, doRowsWritten: 10_000_000, logEvents: 200_000_000, r2ClassBOperations: 10_000_000 }));
    const customerLimits = policy({ workerRequests: 10_000_000, d1RowsRead: 10_000_000, d1RowsWritten: 10_000_000,
      doRequests: 10_000_000, doRowsRead: 10_000_000, doRowsWritten: 10_000_000, logEvents: 200_000_000, r2ClassBOperations: 10_000_000 });
    const customerRestriction = (tenantId: string, limits: Record<string, number> = {}, revision = 1, ownerPolicyRevision = 1) => JSON.stringify({ schemaVersion: 1, tenantId,
      ownerPolicyId: customerLimits.policyId, ownerPolicyRevision, revision, mode: 'conservative',
      limits: { ...Object.fromEntries(customerLimits.budgets.map(item => [item.dimension, item.limit])), ...limits }, disabledFeatures: [] });
    await db.batch([
      db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version) VALUES ('runtime-tenant','runtime-customer','customer@runtime.test','customer',1)"),
      db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version) VALUES ('runtime-tenant-b','runtime-customer','customer@runtime-b.test','customer',1)"),
      db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version) VALUES ('runtime-tenant-c','runtime-customer','customer@runtime-c.test','customer',1)"),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_id,customer_email,source) VALUES ('runtime-tenant-c','r2-budget-ticket','R2 budget boundary','runtime-customer','customer@runtime-c.test','portal')"),
      db.prepare(`INSERT INTO budget_tenant_allocations
        (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
        VALUES ('runtime-deployment','runtime-tenant-b','runtime-owner-policy',1,1,'runtime-namespace-b',?,'active')`).bind(customerRestriction('runtime-tenant-b')),
      db.prepare(`INSERT INTO budget_tenant_allocations
        (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
        VALUES ('runtime-deployment','runtime-tenant-c','runtime-owner-policy',1,1,'runtime-namespace-c',?,'active')`).bind(customerRestriction('runtime-tenant-c', { r2ClassBOperations: 1 })),
    ]);
    const staffToken = await new SignJWT({ sub: 'runtime-staff', role: 'agent', tenant_id: 'runtime-tenant', session_version: 1, mfa_verified: true })
      .setProtectedHeader({ alg: 'HS256' }).setAudience('app').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(jwtSecret));
    const api = await mf.dispatchFetch('http://runtime.test/api/v1/tickets', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ subject: 'API remains enabled', customer_email: 'runtime@example.test', body: 'synthetic' }),
    });
    assert.equal(api.status, 201, 'combined mode retains the active API-key route'); await api.body?.cancel();
    const request = (key: string, body = 'staff synthetic') => mf!.dispatchFetch('http://runtime.test/api/tickets', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${staffToken}`, 'idempotency-key': key },
      body: JSON.stringify({ subject: 'Staff receipt', customer_email: 'runtime@example.test', body, body_format: 'markdown-v1' }),
    });
    const first = await request('staff-combined');
    assert.equal(first.status, 201); const ticket = await first.json() as { id: string };
    const replay = await request('staff-combined');
    assert.equal(replay.status, 201); assert.equal(replay.headers.get('Idempotency-Replayed'), 'true'); await replay.body?.cancel();
    const conflict = await request('staff-combined', 'different canonical payload');
    assert.equal(conflict.status, 409); await conflict.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) AS count FROM tickets WHERE tenant_id='runtime-tenant' AND subject='Staff receipt'").first<{count:number}>())?.count, 1);
    assert.equal((await db.prepare("SELECT count(*) AS count FROM staff_ticket_mutation_receipts WHERE tenant_id='runtime-tenant'").first<{count:number}>())?.count, 1);
    const update = (key: string, body: object) => mf!.dispatchFetch(`http://runtime.test/api/tickets/${ticket.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${staffToken}`, 'idempotency-key': key }, body: JSON.stringify(body),
    });
    const updated = await update('staff-update',{status:'pending',priority:'high',custom_fields:{synthetic:'x'.repeat(60_000)}});
    assert.equal(updated.status,200); assert.deepEqual(await updated.json(),{success:true}); assert.equal(updated.headers.get('Idempotency-Replayed'),'false');
    const updateReplay = await update('staff-update',{priority:'high',status:'pending',custom_fields:{synthetic:'x'.repeat(60_000)}});
    assert.equal(updateReplay.status,200); assert.deepEqual(await updateReplay.json(),{success:true}); assert.equal(updateReplay.headers.get('Idempotency-Replayed'),'true');
    const updateConflict = await update('staff-update',{status:'resolved'}); assert.equal(updateConflict.status,409); await updateConflict.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) AS count FROM staff_ticket_mutation_receipts WHERE tenant_id='runtime-tenant' AND operation='dashboard.ticket.update'").first<{count:number}>())?.count,1);
    assert.equal((await db.prepare("SELECT count(*) AS count FROM conversation_events WHERE tenant_id='runtime-tenant' AND ticket_id=? AND kind='ticket.state_changed'").bind(ticket.id).first<{count:number}>())?.count,1);
    // Miniflare's prerelease binding proxy types currently infer Request here.
    const bucket = await mf.getR2Bucket('ATTACHMENTS_BUCKET') as unknown as R2Bucket;
    await bucket.put('runtime-tenant/agent-attachments/runtime-staff/retry.txt', 'retry attachment', { httpMetadata: { contentType: 'text/plain' } });
    const beforeRetry = await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { r2Gets: number };
    await mf.dispatchFetch('http://runtime.test/__budget-control', { method: 'POST', body: JSON.stringify({ beforeCanonical: 'failure' }) });
    const replyRequest = () => mf!.dispatchFetch(`http://runtime.test/api/tickets/${ticket.id}/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${staffToken}`, 'idempotency-key': 'staff-reply' },
      body: JSON.stringify({ body: 'public **reply**', body_format: 'markdown-v1', is_internal: false,
        attachments: [{ storageKey: 'agent-attachments/runtime-staff/retry.txt', filename: 'retry.txt' }] }),
    });
    const failedReply = await replyRequest();
    assert.equal(failedReply.status, 503, 'the first canonical failure retains a charged retry rather than delivering'); await failedReply.body?.cancel();
    const reply = await replyRequest();
    assert.equal(reply.status, 201); await reply.body?.cancel();
    const afterRetry = await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { r2Gets: number };
    assert.equal(afterRetry.r2Gets - beforeRetry.r2Gets, 3, 'two metadata validation reads plus one winning outbound stream read are bounded');
    await db.prepare("UPDATE users SET session_version=2 WHERE tenant_id='runtime-tenant' AND id='runtime-staff'").run();
    const revoked = await mf.dispatchFetch(`http://runtime.test/api/tickets/${ticket.id}/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${staffToken}`, 'idempotency-key': 'revoked-staff-reply' },
      body: JSON.stringify({ body: 'must not commit' }),
    });
    assert.equal(revoked.status, 401); await revoked.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) AS count FROM articles WHERE tenant_id='runtime-tenant' AND body='must not commit'").first<{count:number}>())?.count, 0);

    const firstCustomerToken = await customerToken(jwtSecret, 'runtime-tenant', 'customer@runtime.test', 1);
    const secondTenantToken = await customerToken(jwtSecret, 'runtime-tenant-b', 'customer@runtime-b.test', 1);
    const r2BudgetToken = await customerToken(jwtSecret, 'runtime-tenant-c', 'customer@runtime-c.test', 1);
    const portalCreate = (token: string, key: string, subject: string) => mf!.dispatchFetch('http://runtime.test/api/v1/customer/tickets', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': key },
      body: JSON.stringify({ subject, message: 'synthetic customer message' }),
    });
    const portalReply = (token: string, ticketId: string, key: string, attachments?: { storageKey: string; filename: string }[]) => mf!.dispatchFetch(`http://runtime.test/api/v1/customer/tickets/${ticketId}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': key },
      body: JSON.stringify({ message: 'synthetic public reply', ...(attachments ? { attachments } : {}) }),
    });
    let widgetRequest = 0;
    const widgetCreate = (token: string, key: string, subject: string, customFields?: Record<string, string>, email = 'customer@runtime.test') => mf!.dispatchFetch('http://runtime.test/api/v1/widget/tickets', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': key,
        'cf-connecting-ip': `127.0.0.${++widgetRequest}` },
      body: JSON.stringify({ subject, email, message: 'synthetic customer message', ...(customFields ? { custom_fields: customFields } : {}) }),
    });

    const portalFirst = await portalCreate(firstCustomerToken, 'customer-portal-create', 'Portal customer receipt');
    assert.equal(portalFirst.status, 201); const portalBody = await portalFirst.json() as { ticket: { id: string } };
    const portalReplay = await portalCreate(firstCustomerToken, 'customer-portal-create', 'Portal customer receipt');
    assert.equal(portalReplay.status, 201); assert.equal(portalReplay.headers.get('Idempotency-Replayed'), 'true'); await portalReplay.body?.cancel();
    const notificationsBeforeReply = await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { notificationBroadcasts: number };
    const portalReplyFirst = await portalReply(firstCustomerToken, portalBody.ticket.id, 'customer-portal-reply');
    assert.equal(portalReplyFirst.status, 201); assert.equal(portalReplyFirst.headers.get('Idempotency-Replayed'), 'false'); await portalReplyFirst.body?.cancel();
    const portalReplyReplay = await portalReply(firstCustomerToken, portalBody.ticket.id, 'customer-portal-reply');
    assert.equal(portalReplyReplay.status, 201); assert.equal(portalReplyReplay.headers.get('Idempotency-Replayed'), 'true'); await portalReplyReplay.body?.cancel();
    const notificationsAfterReplay = await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { notificationBroadcasts: number };
    assert.equal(notificationsAfterReplay.notificationBroadcasts - notificationsBeforeReply.notificationBroadcasts, 1,
      'only the winning customer reply performs its bounded NotificationDO broadcast');
    assert.equal((await db.prepare("SELECT is_internal FROM articles WHERE tenant_id='runtime-tenant' AND ticket_id=? AND body='synthetic public reply'")
      .bind(portalBody.ticket.id).first<{ is_internal: number }>())?.is_internal, 0, 'customer reply remains public');

    const r2Key = 'customer-attachments/runtime-customer/r2-budget.txt';
    await bucket.put(`runtime-tenant-c/${r2Key}`, 'customer reply attachment', { httpMetadata: { contentType: 'text/plain' } });
    const r2Attachment = [{ storageKey: r2Key, filename: 'r2-budget.txt' }];
    const r2BeforeRejected = await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { r2Gets: number };
    const r2Rejected = await portalReply(r2BudgetToken, 'r2-budget-ticket', 'customer-r2-budget-retry', r2Attachment);
    assert.equal(r2Rejected.status, 429, 'customer capacity rejects before an attachment reference can read R2');
    assert.deepEqual(await r2Rejected.json(), { code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' });
    const r2AfterRejected = await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { r2Gets: number };
    assert.equal(r2AfterRejected.r2Gets, r2BeforeRejected.r2Gets, 'a rejected reply performs zero R2 reads');
    const r2Retried = await portalReply(r2BudgetToken, 'r2-budget-ticket', 'customer-r2-budget-retry', r2Attachment);
    assert.equal(r2Retried.status, 429, 'a retry of rejected capacity remains outside attachment storage');
    assert.deepEqual(await r2Retried.json(), { code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' });
    const r2AfterRetry = await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { r2Gets: number };
    assert.equal(r2AfterRetry.r2Gets, r2AfterRejected.r2Gets, 'a rejected retry also performs zero R2 reads');

    const crossSurface = await widgetCreate(firstCustomerToken, 'customer-portal-create', 'Portal customer receipt');
    assert.equal(crossSurface.status, 409, 'the trusted widget source changes the canonical request fingerprint'); await crossSurface.body?.cancel();

    const raceKey = 'customer-widget-admission-race';
    const raceTicket = { id: 'widget-admission-race-ticket', subject: 'Widget admission race', customer_email: 'customer@runtime.test' };
    const raceArticle = { id: 'widget-admission-race-article', body: 'synthetic customer message' };
    const raceInput = { operation: 'portal.ticket.create' as const, source: 'widget' as const, data: {
      subject: raceTicket.subject, customer_email: raceTicket.customer_email, body: raceArticle.body,
      status: 'open', priority: 'normal', assigned_to: null, group_id: null,
    } };
    const raceSnapshot = JSON.stringify({ version: 1, ticket: { tenant_id: 'runtime-tenant', ...raceTicket, status: 'open', priority: 'normal',
      customer_id: 'runtime-customer', assigned_to: null, group_id: null, source: 'widget' }, article: { tenant_id: 'runtime-tenant', ...raceArticle,
      ticket_id: raceTicket.id, sender_id: 'runtime-customer', sender_type: 'customer', is_internal: false, intake_source: 'widget' }, attachments: [] });
    await mf.dispatchFetch('http://runtime.test/__budget-control', { method: 'POST', body: JSON.stringify({ receiptWinner: {
      tenantId: 'runtime-tenant', principalId: 'runtime-customer', operation: 'portal.ticket.create', keyHash: await credentialDigest(raceKey),
      payloadHash: await credentialDigest(`ticket-mutation-v1\n${canonicalMutationJson(raceInput)}`), ticket: raceTicket, article: raceArticle, snapshot: raceSnapshot,
    } }) });
    const widgetAdmissionReplay = await widgetCreate(firstCustomerToken, raceKey, raceTicket.subject);
    assert.equal(widgetAdmissionReplay.status, 201);
    assert.equal(widgetAdmissionReplay.headers.get('Idempotency-Replayed'), 'true');
    const widgetAdmissionBody = await widgetAdmissionReplay.json() as { id?: string; ticket?: unknown };
    assert.ok(widgetAdmissionBody.id, 'an admission-time replay preserves the widget ticket response shape');
    assert.equal(widgetAdmissionBody.ticket, undefined);
    assert.equal((await db.prepare("SELECT count(*) AS count FROM tickets WHERE tenant_id='runtime-tenant' AND source='widget' AND subject='Widget admission race'")
      .first<{ count: number }>())?.count, 1, 'the post-prepare winner is the only widget mutation');

    const isolated = await portalCreate(secondTenantToken, 'customer-portal-create', 'Portal customer receipt');
    assert.equal(isolated.status, 201, 'the same customer id and retry key are tenant-scoped'); await isolated.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) AS count FROM ticket_mutation_receipts WHERE principal_kind='customer' AND operation='portal.ticket.create'")
      .first<{ count: number }>())?.count, 3, 'portal and widget operations share no cross-tenant receipt namespace');

    await mf.dispatchFetch('http://runtime.test/__budget-control', { method: 'POST', body: JSON.stringify({ loseCanonicalAck: true }) });
    const lostResponse = await portalCreate(firstCustomerToken, 'customer-lost-response', 'Lost response receipt');
    assert.equal(lostResponse.status, 201, 'a lost post-commit acknowledgement is recovered only from its durable receipt');
    assert.equal(lostResponse.headers.get('Idempotency-Replayed'), 'true'); await lostResponse.body?.cancel();
    const recovered = await portalCreate(firstCustomerToken, 'customer-lost-response', 'Lost response receipt');
    assert.equal(recovered.status, 201); assert.equal(recovered.headers.get('Idempotency-Replayed'), 'true'); await recovered.body?.cancel();

    await mf.dispatchFetch('http://runtime.test/__budget-control', { method: 'POST', body: JSON.stringify({ beforeCanonical: 'customerSession' }) });
    const revokedAtCommit = await portalCreate(firstCustomerToken, 'customer-revoked-at-commit', 'must not commit at the canonical fence');
    assert.equal(revokedAtCommit.status, 401, 'the customer session is rechecked in the canonical D1 batch after admission'); await revokedAtCommit.body?.cancel();
    const revokedWidget = await widgetCreate(firstCustomerToken, 'customer-widget-revoked', 'must not commit');
    assert.equal(revokedWidget.status, 401, 'widget rejects a revoked current session before admission'); await revokedWidget.body?.cancel();
    const rotatedToken = await customerToken(jwtSecret, 'runtime-tenant', 'customer@runtime.test', 2);
    const rotatedWidget = await widgetCreate(rotatedToken, 'customer-widget-rotated', 'Current widget session', { product: 'Test' });
    const rotatedBody = await rotatedWidget.json() as { custom_fields: string };
    assert.equal(rotatedWidget.status, 201, `the verified widget scope carries the current session version into its canonical fence: ${JSON.stringify(rotatedBody)}`);
    assert.deepEqual(JSON.parse(rotatedBody.custom_fields), { product: 'Test' }, 'widget custom fields survive canonical persistence');
    // Use the independent tenant's untouched three-request widget window;
    // retain the first tenant's existing rate limit and session-rotation proof.
    const widgetFieldCreate = await widgetCreate(secondTenantToken, 'widget-fields', 'Widget fields', { product: 'Test' }, 'customer@runtime-b.test');
    assert.equal(widgetFieldCreate.status, 201);
    await widgetFieldCreate.body?.cancel();
    const widgetFieldReplay = await widgetCreate(secondTenantToken, 'widget-fields', 'Widget fields', { product: 'Test' }, 'customer@runtime-b.test');
    assert.equal(widgetFieldReplay.status, 201);
    assert.equal(widgetFieldReplay.headers.get('Idempotency-Replayed'), 'true');
    assert.deepEqual(JSON.parse((await widgetFieldReplay.json() as { custom_fields: string }).custom_fields), { product: 'Test' });
    const changedFields = await widgetCreate(secondTenantToken, 'widget-fields', 'Widget fields', { product: 'Changed' }, 'customer@runtime-b.test');
    assert.equal(changedFields.status, 409, 'custom fields are part of the widget canonical retry intent');
    await changedFields.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) AS count FROM tickets WHERE tenant_id='runtime-tenant' AND subject IN ('must not commit','must not commit at the canonical fence')")
      .first<{ count: number }>())?.count, 0);
  } finally { await mf?.dispose(); }
});

async function warmHarness(owner = policy({ workerRequests: 1_000, d1RowsRead: 1_000_000, d1RowsWritten: 100_000,
  doRequests: 1_000, doRowsRead: 1_000, doRowsWritten: 1_000, logEvents: 100_000 }), extraTenants = 0, through?: string, restartable = false) {
  const bundled = await build({ entryPoints: [resolve(import.meta.dirname, 'budget-admission-runtime-entry.ts')], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  const persistencePath = restartable ? mkdtempSync(join(tmpdir(), 'tocyn-64-restart-')) : undefined;
  const runtimeOptions = convertV4MiniflareOptions({ resourcePersistencePath: persistencePath, workers: [{ name: 'budget-warm-proof', modules: true,
    compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
    bindings: { BUDGET_ADMISSION_POLICY: 'api-ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true' },
    d1Databases: { DB: 'budget-warm-d1' }, durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' },
    unsafeEphemeralDurableObjects: !restartable,
  }] });
  let mf = new Miniflare(runtimeOptions);
  const db = await mf.getD1Database('DB');
  await applyMigrations(db, through); await seed(db, extraTenants, owner);
  const control = async (value?: object) => (await (await mf.dispatchFetch('http://runtime.test/__budget-control',
    value ? { method: 'POST', body: JSON.stringify(value) } : undefined)).json()) as any;
  const initialNow = Date.now() + 1;
  await control({ now: initialNow });
  const create = (key: string, subject = key, token = apiKey) => mf.dispatchFetch('http://runtime.test/api/v1/tickets', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': token, 'idempotency-key': key },
    body: JSON.stringify({ subject, customer_email: 'runtime@example.test', body: 'synthetic' }),
  });
  const namespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
  const coordinator = namespace.get(namespace.idFromName('runtime-owner-coordinator')) as unknown as BudgetCoordinatorDO;
  const grants = async () => (await coordinator.inspectForTrustedRuntime()).tenantStates.flatMap(state => state.grants);
  const coordinatorState = () => coordinator.inspectForTrustedRuntime();
  const count = async () => (await db.prepare("SELECT count(*) AS count FROM tickets WHERE tenant_id='runtime-tenant'").first<{ count: number }>())?.count;
  const restartCoordinator = async () => {
    await mf.dispose();
    mf = new Miniflare(runtimeOptions);
    const restarted = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    return { coordinator: restarted.get(restarted.idFromName('runtime-owner-coordinator')) as unknown as BudgetCoordinatorDO };
  };
  return { get mf() { return mf; }, persistencePath, db, control, create, coordinator, namespace, grants, coordinatorState, count, initialNow, restartCoordinator };
}

// Synthetic reconstruction is test-only: production accepts the cache's sealed capability.
async function sealedFixture(h: Awaited<ReturnType<typeof warmHarness>>, tenantId = 'runtime-tenant', apiKeyId = 'runtime-key') {
  const scope = createVerifiedTenantScope(tenantId, apiKeyId, ['integration'], 1);
  const repository = new BudgetAuthorityRepository(h.db);
  const authority = await repository.resolveForVerifiedPrincipal(scope, { kind: 'api-key', apiKeyId, requiredPermission: 'tickets:write' }, h.initialNow);
  assert.equal(authority.kind, 'active');
  if (authority.kind !== 'active') throw new Error('missing fixture authority');
  const state = await h.coordinator.inspectForTrustedRuntime();
  const grant = state.tenantStates.find(item => item.tenantId === tenantId)!.grants.find(item => item.purpose === 'new-work')!;
  const rows = (await h.db.prepare(`SELECT operation_id,operation_fingerprint,operation_envelope_json FROM budget_grant_operations
    WHERE tenant_id=? AND reservation_id=? AND holder_id=? ORDER BY operation_id`).bind(tenantId, grant.reservationId, grant.holderId)
    .all<{ operation_id: string; operation_fingerprint: string; operation_envelope_json: string }>()).results as { operation_id: string; operation_fingerprint: string; operation_envelope_json: string }[];
  const operations = rows.map(row => ({ operationId: row.operation_id, operationFingerprint: row.operation_fingerprint, operationEnvelope: JSON.parse(row.operation_envelope_json) }));
  const sealed = { tenantId, aggregateId: 'runtime-owner-coordinator', reservationId: grant.reservationId, holderId: grant.holderId,
    credentialKey: `api-key:${apiKeyId}:tickets:write`, snapshot: authority.commitSnapshot, expiresAt: grant.expiresAt,
    policyId: 'runtime-owner-policy', policyRevision: 1, restrictionRevision: 1, terminalEvidenceId: `closure:${crypto.randomUUID()}`,
    operations, operationIds: operations.map(item => item.operationId),
    operationFingerprint: JSON.stringify(operations.map(item => [item.operationId, item.operationFingerprint, JSON.stringify(item.operationEnvelope)])),
    operationEnvelopes: operations.map(item => item.operationEnvelope), envelope: grant.envelope };
  return { sealed, grant, recovery: new BudgetGrantRecoveryService(h.db, repository, h.namespace as unknown as DurableObjectNamespace, scope, apiKeyId) };
}

for (const malformed of ['ids', 'duplicate', 'empty-envelope', 'unknown-dimension', 'overflow', 'too-many'] as const) {
  test(`native closure strictly rejects ${malformed} operation shape without releasing charges`, async () => {
    const h = await warmHarness();
    try {
      const response = await h.create('shape'); assert.equal(response.status, 201); await response.body?.cancel();
      const { sealed, grant } = await sealedFixture(h);
      if (malformed === 'ids') sealed.operationIds = ['different-id'];
      if (malformed === 'duplicate') sealed.operations.push(sealed.operations[0]);
      if (malformed === 'too-many') sealed.operations = Array.from({ length: 9 }, () => sealed.operations[0]);
      if (['empty-envelope', 'unknown-dimension', 'overflow'].includes(malformed)) {
        const envelope = malformed === 'empty-envelope' ? {} : malformed === 'unknown-dimension' ? { invented: 1 } : { workerRequests: Number.MAX_SAFE_INTEGER + 1 };
        sealed.operations[0].operationEnvelope = envelope;
        sealed.operationEnvelopes = [envelope];
        await h.db.prepare('UPDATE budget_grant_operations SET operation_envelope_json=?').bind(JSON.stringify(envelope)).run();
      }
      assert.equal(await new BudgetGrantClosureRepository(h.db).close(sealed), null);
      assert.equal((await h.db.prepare('SELECT count(*) AS n FROM budget_grant_closures').first<{ n: number }>())!.n, 0);
      assert.deepEqual((await h.grants())[0].accounted, grant.accounted);
    } finally { await h.mf.dispose(); }
  });
}

test('native recovery rejects another tenant sealed grant even under the same owner aggregate', async () => {
  const h = await warmHarness(undefined, 1);
  try {
    const otherKey = `lt_budget_other.${randomBytes(32).toString('hex')}`;
    await h.db.prepare(`INSERT INTO api_keys (tenant_id,id,name,key_hash,prefix,permissions,is_active,created_at)
      VALUES ('runtime-extra-000','runtime-other-key','synthetic other',?,'lt_budget','tickets:write',1,unixepoch())`).bind(await credentialDigest(otherKey)).run();
    for (const token of [apiKey, otherKey]) { const response = await h.create('same-key', 'tenant recovery', token); assert.equal(response.status, 201); await response.body?.cancel(); }
    const own = await sealedFixture(h);
    const other = await sealedFixture(h, 'runtime-extra-000', 'runtime-other-key');
    const before = await h.grants();
    assert.equal(await own.recovery.recover(other.sealed, h.initialNow + 1), 'rejected');
    assert.deepEqual(await h.grants(), before, 'foreign recovery cannot allocate or release either tenant capacity');
    assert.equal(await other.recovery.recover(other.sealed, h.initialNow + 1), 'reconciled');
    assert.deepEqual((await h.grants()).find(item => item.reservationId === own.grant.reservationId)?.accounted, own.grant.accounted);
  } finally { await h.mf.dispose(); }
});

async function waitCanonical(h: Awaited<ReturnType<typeof warmHarness>>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await h.control()).canonicalPaused) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('native canonical gate was not reached');
}
async function canonicalCounts(h: Awaited<ReturnType<typeof warmHarness>>) {
  const result: Record<string, number> = {};
  for (const table of ['tickets', 'articles', 'attachments', 'conversation_events', 'ticket_sla_events', 'ticket_mutation_receipts', 'budget_grant_operations']) {
    result[table] = (await h.db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
  }
  return result;
}

test('native admitted in-flight operation prevents idle sealing and retains the whole grant', async () => {
  const h = await warmHarness();
  try {
    const first = await h.create('in-flight-first'); assert.equal(first.status, 201); await first.body?.cancel();
    const original = (await h.grants())[0];
    await h.control({ pauseNextCanonical: true });
    const pending = h.create('in-flight-second'); await waitCanonical(h);
    await h.control({ now: h.initialNow + 30_001 });
    const third = await h.create('in-flight-third'); assert.equal(third.status, 201); await third.body?.cancel();
    assert.equal((await h.control()).calls.reconcile, 0);
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM budget_grant_closures').first<{ n: number }>())!.n, 0);
    await h.control({ releaseCanonical: true });
    const second = await pending; assert.equal(second.status, 201); await second.body?.cancel();
    assert.equal((await h.grants()).length, 1);
    assert.deepEqual((await h.grants())[0].accounted, original.accounted);
    assert.equal((await canonicalCounts(h)).budget_grant_operations, 3);
  } finally { await h.mf.dispose(); }
});

test('native concurrent same-operation attempt remains in flight until both canonical attempts settle', async () => {
  const h = await warmHarness();
  let pending: ReturnType<typeof h.create> | undefined;
  try {
    await h.control({ pauseNextCanonical: true });
    pending = h.create('in-flight-same'); await waitCanonical(h);
    const winner = await h.create('in-flight-same'); assert.equal(winner.status, 201); await winner.body?.cancel();
    await h.control({ now: h.initialNow + 30_001 });
    const later = await h.create('same-operation-idle-trigger'); assert.equal(later.status, 201); await later.body?.cancel();
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM budget_grant_closures').first<{ n: number }>())!.n, 0,
      'one completed attempt must not hide another admitted canonical attempt');
    assert.equal((await h.control()).calls.reconcile, 0);
    await h.control({ releaseCanonical: true });
    const earlier = await pending; assert.equal(earlier.status, 201); await earlier.body?.cancel();
    assert.equal(await h.count(), 2);
  } finally { await h.control({ releaseCanonical: true }); await pending?.then(response => response.body?.cancel()).catch(() => {}); await h.mf.dispose(); }
});

test('native D1 closure rolls back a stale admitted canonical batch and preserves receipt replay', async () => {
  const h = await warmHarness();
  try {
    const first = await h.create('sealed-first'); assert.equal(first.status, 201); await first.body?.cancel();
    const { sealed, grant } = await sealedFixture(h);
    const before = await canonicalCounts(h);
    await h.control({ pauseNextCanonical: true });
    const pending = h.create('stale-admitted'); await waitCanonical(h);
    // Force the adverse interleaving independently of the local holder fence.
    assert.ok(await new BudgetGrantClosureRepository(h.db).close(sealed));
    await h.control({ releaseCanonical: true });
    const stale = await pending; assert.equal(stale.status, 503); await stale.body?.cancel();
    assert.deepEqual(await canonicalCounts(h), before, 'every canonical side effect and operation link rolls back');
    const retry = await h.create('stale-admitted'); assert.equal(retry.status, 503); await retry.body?.cancel();
    const fresh = await h.create('new-after-durable-closure'); assert.equal(fresh.status, 503); await fresh.body?.cancel();
    assert.deepEqual(await canonicalCounts(h), before);
    const replay = await h.create('sealed-first'); assert.equal(replay.status, 201);
    assert.equal(replay.headers.get('Idempotency-Replayed'), 'true'); await replay.body?.cancel();
    assert.deepEqual((await h.grants())[0].accounted, grant.accounted);
  } finally { await h.mf.dispose(); }
});

for (const change of ['key', 'permission', 'authority', 'policy', 'restriction', 'namespace', 'aggregate', 'expiry', 'credential'] as const) {
  test(`native whole-grant recovery retains charges after ${change} changes`, async () => {
    const h = await warmHarness();
    try {
      const response = await h.create('authority-closure'); assert.equal(response.status, 201); await response.body?.cancel();
      const { sealed, grant, recovery } = await sealedFixture(h);
      const edits = {
        key: "UPDATE api_keys SET is_active=0",
        permission: "UPDATE api_keys SET permissions='tickets:read'",
        authority: "UPDATE budget_deployment_authority SET state='revoked'",
        policy: "UPDATE budget_owner_policies SET policy_json=policy_json||' '",
        restriction: "UPDATE budget_tenant_allocations SET restriction_json=restriction_json||' '",
        namespace: "UPDATE budget_tenant_allocations SET reservation_namespace='changed-namespace'",
        aggregate: "UPDATE budget_owner_policies SET coordinator_id='changed-aggregate'",
      };
      if (change in edits) await h.db.prepare(edits[change as keyof typeof edits]).run();
      if (change === 'credential') sealed.credentialKey = 'api-key:other-key:tickets:write';
      assert.equal(await recovery.recover(sealed, change === 'expiry' ? grant.expiresAt : h.initialNow + 1), 'rejected');
      assert.deepEqual((await h.grants())[0].accounted, grant.accounted);
      assert.equal((await h.grants()).length, 1, 'invalid authority cannot allocate recovery capacity');
      assert.equal((await h.db.prepare('SELECT count(*) AS n FROM budget_grant_closures').first<{ n: number }>())!.n, 0);
    } finally { await h.mf.dispose(); }
  });
}

test('native exhausted recovery partition retains sealed new-work charges and bounds retries', async () => {
  const h = await warmHarness(policy({ workerRequests: 1_000, d1RowsRead: 1_000_000, d1RowsWritten: 100_000,
    doRequests: 1_000, doRowsRead: 1_000, doRowsWritten: 1_000, logEvents: 100_000 }));
  try {
    const response = await h.create('recovery-exhaustion'); assert.equal(response.status, 201); await response.body?.cancel();
    const original = (await h.grants())[0];
    const spent = await h.coordinator.reserveFromTrustedAuthority({ tenantId: 'runtime-tenant', holderId: 'synthetic-recovery-full',
      idempotencyKey: 'synthetic-recovery-full', purpose: 'recovery', envelope: { workerRequests: 200 },
      expectedPolicyId: 'runtime-owner-policy', expectedPolicyRevision: 1, expectedRestrictionRevision: 1, now: h.initialNow });
    assert.equal(spent.status, 'granted');
    await h.control({ now: h.initialNow + 30_001 });
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => h.create(`exhausted-recovery-${index}`)));
    assert.ok(responses.every(item => item.status === 429)); await Promise.all(responses.map(item => item.body?.cancel()));
    const control = await h.control(); assert.equal(control.calls.reserve, 3); assert.equal(control.calls.reconcile, 0);
    assert.deepEqual((await h.grants()).find(item => item.reservationId === original.reservationId)?.accounted, original.accounted);
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM budget_grant_closures').first<{ n: number }>())!.n, 0);
    await h.control({ now: original.expiresAt + 1 });
    await advanceRuntimePolicy(h, 2, original.expiresAt + 60_000);
    const renewed = await h.create('expired-recovery-new-charge'); assert.equal(renewed.status, 201); await renewed.body?.cancel();
    assert.deepEqual((await h.grants()).find(item => item.reservationId === original.reservationId)?.accounted, original.accounted,
      'expiry only permits a fresh paid admission; it never releases the failed closure charge');
    assert.equal((await h.control()).calls.reconcile, 0);
  } finally { await h.mf.dispose(); }
});

test('native parallel closure retries consume at most two prepaid attempts and successful closure stops replay', async () => {
  const h = await warmHarness();
  try {
    const first = await h.create('parallel-recovery'); assert.equal(first.status, 201); await first.body?.cancel();
    await h.control({ now: h.initialNow + 30_001, loseReconcileAcks: 1 });
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => h.create(`parallel-recovery-${index}`)));
    assert.ok(responses.every(item => [201, 429].includes(item.status))); await Promise.all(responses.map(item => item.body?.cancel()));
    // If the second concurrent INSERT lost its race, the failed scope remains
    // blocked. Identical concurrent closure inserts should both observe evidence.
    const after = await h.create('parallel-recovery-after'); assert.equal(after.status, 201); await after.body?.cancel();
    const calls = (await h.control()).calls;
    assert.equal(calls.reconcile, 2);
    const recovery = (await h.grants()).filter(item => item.purpose === 'recovery');
    assert.equal(recovery.length, 1); assert.equal(recovery[0].holderSeedAttempts, 2);
    assert.deepEqual(recovery[0].accounted, recovery[0].envelope, 'all recovery overhead remains conservatively charged');
    const replay = await h.create('parallel-recovery'); assert.equal(replay.status, 201); await replay.body?.cancel();
    assert.deepEqual((await h.control()).calls, calls, 'completed recovery and canonical receipt replay do not repeat RPCs');
  } finally { await h.mf.dispose(); }
});

test('native closure exact-set collision, indexed eight-row bound and ninth-row sentinel fail closed', async () => {
  const h = await warmHarness();
  try {
    for (let index = 0; index < 8; index++) { const response = await h.create(`bound-${index}`); assert.equal(response.status, 201); await response.body?.cancel(); }
    const { sealed, grant } = await sealedFixture(h);
    assert.equal(sealed.operations.length, 8);
    const query = 'SELECT operation_id,operation_fingerprint,operation_envelope_json,aggregate_id FROM budget_grant_operations WHERE tenant_id=? AND reservation_id=? AND holder_id=? ORDER BY operation_id LIMIT ?';
    const args = [sealed.tenantId, sealed.reservationId, sealed.holderId, 9];
    const plan = (await h.db.prepare(`EXPLAIN QUERY PLAN ${query}`).bind(...args).all<{ detail: string }>()).results.map((row: { detail: string }) => row.detail).join(' ');
    assert.match(plan, /SEARCH budget_grant_operations USING INDEX/); assert.doesNotMatch(plan, /SCAN |TEMP B-TREE/);
    const lookup = await h.db.prepare(query).bind(...args).all(); assert.equal(lookup.results.length, 8); assert.ok(lookup.meta.rows_read <= 8);
    const repository = new BudgetGrantClosureRepository(h.db);
    const mismatch = structuredClone(sealed); mismatch.operations[0].operationFingerprint = 'conflicting-fingerprint';
    assert.equal(await repository.close(mismatch), null);
    const wrongNamespace = { ...sealed, reservationId: 'foreign-reservation' }; assert.equal(await repository.close(wrongNamespace), null);
    await h.db.prepare(`INSERT INTO budget_grant_operations (tenant_id,reservation_id,holder_id,operation_id,aggregate_id,operation_fingerprint,operation_envelope_json)
      VALUES (?,?,?,?,?,?,?)`).bind(sealed.tenantId,sealed.reservationId,sealed.holderId,'ninth',sealed.aggregateId,'ninth','{"workerRequests":2}').run();
    assert.equal(await repository.close(sealed), null, 'ninth-row sentinel rejects an incomplete operation set');
    assert.deepEqual((await h.grants())[0].accounted, grant.accounted);
  } finally { await h.mf.dispose(); }
});

test('native identical concurrent closures are idempotent and conflicting terminal evidence retains accounting', async () => {
  const h = await warmHarness();
  try {
    const response = await h.create('closure-collision'); assert.equal(response.status, 201); await response.body?.cancel();
    const { sealed, grant, recovery } = await sealedFixture(h);
    const repository = new BudgetGrantClosureRepository(h.db);
    const closures = await Promise.all([repository.close(sealed), repository.close(sealed)]);
    assert.ok(closures.every(Boolean)); assert.deepEqual(closures[0], closures[1]);
    assert.equal(await repository.close({ ...sealed, terminalEvidenceId: 'different-terminal' }), null);
    assert.equal(await repository.close({ ...sealed, expiresAt: sealed.expiresAt + 1 }), null, 'closure retry must retain its original recovery horizon');
    assert.equal(await recovery.recover({ ...sealed, terminalEvidenceId: 'different-terminal' }, h.initialNow + 1), 'pending');
    assert.deepEqual((await h.grants()).find(item => item.reservationId === grant.reservationId)?.accounted, grant.accounted);
    assert.equal(await recovery.recover(sealed, h.initialNow + 1), 'reconciled');
    const tenant = (await h.coordinatorState()).tenantStates.find(item => item.tenantId === sealed.tenantId)!;
    assert.equal(tenant.grants.find(item => item.reservationId === grant.reservationId)?.compacted, true, 'certified closure releases only its detailed slot');
    assert.deepEqual(tenant.closedCharges.find(charge => charge.dimension === 'workerRequests' && charge.purpose === 'new-work')?.units,
      closures[0]!.uncertain.workerRequests, 'the closed allocation charge remains durable after detail compaction');
    const rejected = await h.coordinator.reconcileFromTrustedAuthority({ tenantId: sealed.tenantId, reservationId: sealed.reservationId,
      holderId: sealed.holderId, expectedPolicyId: sealed.policyId, expectedPolicyRevision: 1, expectedRestrictionRevision: 1,
      terminalEvidenceId: sealed.terminalEvidenceId, measured: {}, uncertain: {}, now: h.initialNow + 1 });
    assert.equal(rejected, 'rejected');
    assert.equal(await recovery.recover(sealed, h.initialNow + 1), 'reconciled', 'the exact durable completion fingerprint proves a lost coordinator response');
  } finally { await h.mf.dispose(); }
});

test('native API recovery reclaims both purpose slots beyond maxReservations while retaining every charge', async () => {
  const owner = policy({ workerRequests: 10_000, d1RowsRead: 10_000_000, d1RowsWritten: 1_000_000,
    doRequests: 10_000, doRowsRead: 10_000, doRowsWritten: 10_000, logEvents: 1_000_000 });
  for (const budget of owner.budgets) budget.window.endsAt += 600_000;
  const h = await warmHarness(owner);
  try {
    await h.db.prepare('UPDATE budget_owner_policies SET max_reservations=2').run();
    const first = await h.create('sustained-0'); assert.equal(first.status, 201); await first.body?.cancel();
    for (let cycle = 1; cycle <= 3; cycle++) {
      await h.control({ now: h.initialNow + cycle * 30_001 });
      const next = await h.create(`sustained-${cycle}`); assert.equal(next.status, 201, `actual recovery cycle ${cycle}`); await next.body?.cancel();
      const state = await h.coordinatorState();
      const charges = state.tenantStates[0].closedCharges;
      assert.equal(charges.find(row => row.dimension === 'workerRequests' && row.purpose === 'new-work')?.units, cycle * 2);
      assert.equal(charges.find(row => row.dimension === 'workerRequests' && row.purpose === 'recovery')?.units, cycle * 2);
      assert.equal((await h.control()).calls.reconcile, cycle, 'one automatic closure RPC per whole grant');
    }
    assert.equal(await h.count(), 4);
  } finally { await h.mf.dispose(); }
});

test('native coordinator rejects a never-completed missing reservation with a syntactically valid closure certificate', async () => {
  const h = await warmHarness();
  try {
    const response = await h.create('initialize-missing-proof'); assert.equal(response.status, 201); await response.body?.cancel();
    const { sealed } = await sealedFixture(h);
    const before = await h.coordinatorState();
    const outcome = await h.coordinator.reconcileFromTrustedAuthority({ tenantId: sealed.tenantId, reservationId: 'never-reserved', holderId: sealed.holderId,
      expectedPolicyId: sealed.policyId, expectedPolicyRevision: 1, expectedRestrictionRevision: 1, terminalEvidenceId: sealed.terminalEvidenceId,
      measured: {}, uncertain: {}, now: h.initialNow + 1, certifiedClosure: { operationSetFingerprint: 'syntactically-valid', expiresAt: sealed.expiresAt } });
    assert.equal(outcome, 'rejected'); assert.equal(JSON.stringify(await h.coordinatorState()), JSON.stringify(before));
  } finally { await h.mf.dispose(); }
});

test('native compacted completion survives a Worker restart and requires the exact certificate and accounting', async () => {
  const h = await warmHarness(undefined, 0, undefined, true);
  try {
    const response = await h.create('restart-certified'); assert.equal(response.status, 201); await response.body?.cancel();
    const { sealed, recovery } = await sealedFixture(h);
    const closure = await new BudgetGrantClosureRepository(h.db).close(sealed); assert.ok(closure);
    assert.equal(await recovery.recover(sealed, h.initialNow + 1), 'reconciled');
    const recoveryGrant = (await h.grants()).find(grant => grant.purpose === 'recovery')!;
    const input = { tenantId: sealed.tenantId, reservationId: sealed.reservationId, holderId: sealed.holderId,
      expectedPolicyId: sealed.policyId, expectedPolicyRevision: 1, expectedRestrictionRevision: 1, terminalEvidenceId: sealed.terminalEvidenceId,
      measured: {}, uncertain: closure.uncertain, now: h.initialNow + 1, certifiedClosure: { operationSetFingerprint: closure.operationSetFingerprint,
        expiresAt: sealed.expiresAt, recoveryReservationId: recoveryGrant.reservationId, recoveryHolderId: recoveryGrant.holderId } };
    const before = JSON.stringify(await h.coordinatorState());
    const { coordinator: restarted } = await h.restartCoordinator();
    assert.equal(await restarted.reconcileFromTrustedAuthority(input), 'already-reconciled');
    for (const wrong of [{ ...input, reservationId: 'never-completed' }, { ...input, uncertain: {} },
      { ...input, certifiedClosure: { ...input.certifiedClosure, operationSetFingerprint: 'different-set' } },
      { ...input, terminalEvidenceId: 'different-terminal' }, { ...input, tenantId: 'runtime-extra-000' }]) {
      assert.equal(await restarted.reconcileFromTrustedAuthority(wrong), 'rejected');
    }
    assert.equal(JSON.stringify(await restarted.inspectForTrustedRuntime()), before);
  } finally { await h.mf.dispose(); if (h.persistencePath) rmSync(h.persistencePath, { recursive: true, force: true }); }
});

test('native 0040 to 0041 upgrade preserves legacy closure rows with unknown expiry', async () => {
  const h = await warmHarness(undefined, 0, '0040_budget_grant_closures.sql');
  try {
    await h.db.batch([
      h.db.prepare(`INSERT INTO budget_grant_operations (tenant_id,reservation_id,holder_id,operation_id,aggregate_id,operation_fingerprint,operation_envelope_json)
        VALUES ('runtime-tenant','legacy-reservation','legacy-holder','legacy-operation','runtime-owner-coordinator','legacy-fingerprint','{"workerRequests":2}')`),
      h.db.prepare(`INSERT INTO budget_grant_closures (tenant_id,reservation_id,holder_id,aggregate_id,terminal_evidence_id,operation_set_fingerprint,operation_count,measured_json,uncertain_json)
        VALUES ('runtime-tenant','legacy-reservation','legacy-holder','runtime-owner-coordinator','legacy-terminal','legacy-set',1,'[]','[["workerRequests",2]]')`),
    ]);
    const before = await h.db.prepare('SELECT * FROM budget_grant_closures').first();
    await h.db.batch(splitSql(readFileSync(join(serverRoot, 'migrations/0041_budget_grant_closure_expiry.sql'), 'utf8')).map(sql => h.db.prepare(sql)));
    const after = await h.db.prepare('SELECT * FROM budget_grant_closures').first();
    assert.deepEqual(after, { ...before, expires_at: null });
    await new BudgetGrantClosureRepository(h.db).pruneExpired('runtime-tenant', Number.MAX_SAFE_INTEGER);
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM budget_grant_closures').first<{ n: number }>())!.n, 1);
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{ n: number }>())!.n, 1);
    const response = await h.create('post-upgrade'); assert.equal(response.status, 201); await response.body?.cancel();
    const { sealed, recovery } = await sealedFixture(h);
    assert.equal(await recovery.recover(sealed, h.initialNow + 1), 'reconciled');
    assert.equal((await h.db.prepare('SELECT expires_at FROM budget_grant_closures WHERE terminal_evidence_id=?').bind(sealed.terminalEvidenceId).first<{ expires_at: number }>())!.expires_at, sealed.expiresAt);
  } finally { await h.mf.dispose(); }
});

test('concurrent cold admission shares one allocation and warm canonical replay never repeats a mutation', async () => {
  const h = await warmHarness();
  try {
    const concurrent = await Promise.all(Array.from({ length: 5 }, (_, index) => h.create(`concurrent-${index}`)));
    assert.deepEqual(concurrent.map(response => response.status), [201, 201, 201, 201, 201]);
    await Promise.all(concurrent.map(response => response.body?.cancel()));
    assert.deepEqual((await h.control()).calls, { refresh: 1, reserve: 1, revoke: 0, reconcile: 0 });
    assert.equal((await h.grants()).length, 1);
    const before = await h.control();
    const same = await Promise.all([h.create('same-operation'), h.create('same-operation')]);
    assert.equal(same.filter(response => response.status === 201).length >= 1, true);
    assert.equal(same.every(response => [201, 503].includes(response.status)), true);
    await Promise.all(same.map(response => response.body?.cancel()));
    const replay = await h.create('same-operation');
    assert.equal(replay.status, 201); assert.equal(replay.headers.get('Idempotency-Replayed'), 'true'); await replay.body?.cancel();
    const conflict = await h.create('same-operation', 'different normalized work');
    assert.equal(conflict.status, 409); await conflict.body?.cancel();
    assert.equal(await h.count(), 6, 'one durable canonical mutation for the concurrent same-key operation');
    const after = await h.control();
    assert.deepEqual(after.calls, before.calls, 'warm and canonical replay/conflict make no DO calls');
    assert.equal(after.cache.operations, 6);
  } finally { await h.mf.dispose(); }
});

test('idle API closure reconciles the entire two-operation grant', async () => {
  const owner = policy({ workerRequests: 1_000, d1RowsRead: 1_000_000, d1RowsWritten: 100_000,
    doRequests: 1_000, doRowsRead: 1_000, doRowsWritten: 1_000, logEvents: 100_000 });
  const h = await warmHarness(owner);
  try {
    for (const key of ['closure-one','closure-two']) {
      const response = await h.create(key); assert.equal(response.status,201); await response.body?.cancel();
      assert.equal((await h.control()).calls.reconcile, 0, 'individual receipts cannot reconcile an open grant');
    }
    const original = (await h.grants())[0];
    await h.control({ now: h.initialNow + 30_001 });
    const trigger = await h.create('closure-after-idle');
    const triggerBody = await trigger.text();
    const afterTrigger = await h.grants();
    const closure = await h.db.prepare(`SELECT terminal_evidence_id,uncertain_json FROM budget_grant_closures
      WHERE tenant_id='runtime-tenant' AND reservation_id=? AND holder_id=?`).bind(original.reservationId,original.holderId)
      .first<{terminal_evidence_id:string;uncertain_json:string}>();
    assert.ok(closure,'closure is durable before coordinator reconciliation');
    const operationRows = (await h.db.prepare(`SELECT operation_id,operation_fingerprint,operation_envelope_json FROM budget_grant_operations
      WHERE tenant_id='runtime-tenant' AND reservation_id=? AND holder_id=? ORDER BY operation_id`).bind(original.reservationId,original.holderId).all<{
        operation_id:string;operation_fingerprint:string;operation_envelope_json:string
      }>()).results as { operation_id:string;operation_fingerprint:string;operation_envelope_json:string }[];
    assert.equal(operationRows.length, 2, 'later work cannot spend the original sealed holder');
    const expectedUncertain: Record<string, number> = { doRequests: 8, doRowsRead: 8, doRowsWritten: 8, logEvents: 8 };
    for (const row of operationRows) for (const [dimension,units] of Object.entries(JSON.parse(row.operation_envelope_json) as Record<string,number>)) {
      expectedUncertain[dimension] = (expectedUncertain[dimension] ?? 0) + units;
    }
    const tenant = (await h.coordinatorState()).tenantStates.find(item => item.tenantId === 'runtime-tenant')!;
    assert.equal(afterTrigger.find(grant => grant.reservationId === original.reservationId)?.compacted, true, 'the certified holder detail is compacted');
    assert.deepEqual(Object.fromEntries(tenant.closedCharges.filter(charge => charge.purpose === 'new-work')
      .map(charge => [charge.dimension, charge.units])), expectedUncertain, 'cold control and all assigned operation envelopes remain charged');
    assert.equal(original.envelope.workerRequests! - (tenant.closedCharges.find(charge => charge.dimension === 'workerRequests')?.units ?? 0), 12,
      'only six unused two-request operations are released');
    assert.equal(afterTrigger.filter(grant => grant.purpose === 'new-work' && !grant.compacted).length, 1, 'later work uses a newly charged holder');
    assert.equal((await h.control()).calls.reconcile, 1, 'automatic closure sends one whole-grant reconciliation');
    const recovery = new BudgetGrantRecoveryService(h.db,new BudgetAuthorityRepository(h.db),h.namespace as unknown as DurableObjectNamespace,
      createVerifiedTenantScope('runtime-tenant','runtime-key',['integration'],1),'runtime-key');
    const recovered = await recovery.recover({ ...(await sealedFixture(h)).sealed, tenantId: 'runtime-tenant', aggregateId: 'runtime-owner-coordinator', reservationId: original.reservationId,
      holderId: original.holderId, policyId: 'runtime-owner-policy', policyRevision: 1, restrictionRevision: 1,
      terminalEvidenceId: closure!.terminal_evidence_id, operations: operationRows.map(row => ({ operationId: row.operation_id,
        operationFingerprint: row.operation_fingerprint, operationEnvelope: JSON.parse(row.operation_envelope_json) })),
      operationIds: operationRows.map(row => row.operation_id), operationFingerprint: 'test',
      operationEnvelopes: operationRows.map(row => JSON.parse(row.operation_envelope_json)), envelope: original.envelope,
      expiresAt: original.expiresAt },h.initialNow + 30_001);
    assert.equal(recovered,'reconciled',`recovery service result: ${recovered}`);
    const uncertain = Object.fromEntries(JSON.parse(closure!.uncertain_json)) as Record<string,number>;
    const result = await h.coordinator.reconcileFromTrustedAuthority({ tenantId: 'runtime-tenant', reservationId: original.reservationId,
      holderId: original.holderId, expectedPolicyId: 'runtime-owner-policy', expectedPolicyRevision: 1, expectedRestrictionRevision: 1,
      terminalEvidenceId: closure!.terminal_evidence_id, measured: {}, uncertain, now: h.initialNow + 30_001 });
    assert.equal(result,'rejected',`uncertified direct retry must not claim a compacted closure; trigger=${trigger.status} ${triggerBody}`);
    assert.equal(trigger.status,201,`${triggerBody}; afterTrigger=${JSON.stringify(afterTrigger.map(grant => [grant.reservationId,grant.purpose,grant.status]))}`);
  } finally { await h.mf.dispose(); }
});

test('an unknown canonical outcome never seals or reconciles its prepaid grant', async () => {
  const owner = policy({ workerRequests: 1_000, d1RowsRead: 1_000_000, d1RowsWritten: 100_000,
    doRequests: 1_000, doRowsRead: 1_000, doRowsWritten: 1_000, logEvents: 100_000 });
  const h = await warmHarness(owner);
  try {
    await h.control({ failCanonicalAttempts: 1 });
    const failed = await h.create('unknown-canonical'); assert.equal(failed.status,503); await failed.body?.cancel();
    const original = (await h.grants())[0];
    await h.control({ now: h.initialNow + 30_001 });
    const later = await h.create('after-unknown'); assert.equal(later.status,201); await later.body?.cancel();
    assert.equal((await h.db.prepare('SELECT count(*) AS count FROM budget_grant_closures').first<{count:number}>())?.count,0);
    assert.equal((await h.grants()).find(grant => grant.reservationId === original.reservationId)?.status,'reserved');
    assert.equal((await h.control()).calls.reconcile,0);
  } finally { await h.mf.dispose(); }
});

test('lost reconciliation replies use two bounded attempts and then block the sealed scope', async () => {
  const owner = policy({ workerRequests: 1_000, d1RowsRead: 1_000_000, d1RowsWritten: 100_000,
    doRequests: 1_000, doRowsRead: 1_000, doRowsWritten: 1_000, logEvents: 100_000 });
  const h = await warmHarness(owner);
  try {
    for (const key of ['lost-reconcile-one','lost-reconcile-two']) { const response = await h.create(key); assert.equal(response.status,201); await response.body?.cancel(); }
    await h.control({ now: h.initialNow + 30_001, loseReconcileAcks: 2 });
    for (const key of ['lost-reconcile-trigger-one','lost-reconcile-trigger-two','lost-reconcile-trigger-three']) {
      const response = await h.create(key); assert.equal(response.status,429); await response.body?.cancel();
    }
    const control = await h.control();
    assert.equal(control.calls.reconcile,2);
    assert.equal((await h.grants()).filter(grant => grant.purpose === 'recovery').length,1);
    assert.equal((await h.grants()).some(grant => grant.purpose === 'new-work' && !grant.compacted),false);
    assert.ok((await h.coordinatorState()).tenantStates.find(tenant => tenant.tenantId === 'runtime-tenant')?.closedCharges.length,
      'lost coordinator acknowledgements retain the certified new-work charge without retaining a slot');
  } finally { await h.mf.dispose(); }
});

test('native expired closure cleanup removes only stale D1 proof while retained certified accounting survives', async () => {
  const h = await warmHarness();
  try {
    const response = await h.create('closure-prune'); assert.equal(response.status, 201); await response.body?.cancel();
    const { sealed, recovery } = await sealedFixture(h);
    assert.equal(await recovery.recover(sealed, h.initialNow + 1), 'reconciled');
    const before = (await h.coordinatorState()).tenantStates.find(tenant => tenant.tenantId === sealed.tenantId)!;
    const retained = structuredClone(before.closedCharges);
    assert.ok(retained.length);
    const closureRepository = new BudgetGrantClosureRepository(h.db);
    await closureRepository.pruneExpired(sealed.tenantId, sealed.expiresAt);
    assert.equal((await h.db.prepare('SELECT count(*) AS count FROM budget_grant_closures WHERE tenant_id=?').bind(sealed.tenantId)
      .first<{ count: number }>())?.count, 0);
    assert.equal((await h.db.prepare('SELECT count(*) AS count FROM budget_grant_operations WHERE tenant_id=?').bind(sealed.tenantId)
      .first<{ count: number }>())?.count, 0);
    const after = (await h.coordinatorState()).tenantStates.find(tenant => tenant.tenantId === sealed.tenantId)!;
    assert.deepEqual(after.closedCharges, retained, 'expiry removes retry evidence only after its policy horizon; stock/window accounting remains');
    assert.equal(await recovery.recover(sealed, sealed.expiresAt), 'rejected', 'expired proof can never authorize delayed recovery');
  } finally { await h.mf.dispose(); }
});

test('one lost committed cold response retries into the same live holder and keeps warm execution local', async () => {
  const h = await warmHarness();
  try {
    await h.control({ loseReserveAck: true });
    const first = await h.create('lost-allocation-ack'); assert.equal(first.status, 201); await first.body?.cancel();
    assert.deepEqual((await h.control()).calls, { refresh: 2, reserve: 2, revoke: 0, reconcile: 0 });
    assert.equal((await h.grants()).length, 1);
    assert.equal((await h.grants())[0].holderSeedAttempts, 2);
    const second = await h.create('warm-after-recovered-ack'); assert.equal(second.status, 201); await second.body?.cancel();
    assert.deepEqual((await h.control()).calls, { refresh: 2, reserve: 2, revoke: 0, reconcile: 0 });
    assert.equal(await h.count(), 2);
  } finally { await h.mf.dispose(); }
});

test('two lost committed responses exhaust the finite cold retry and retain the unacknowledged charge', async () => {
  const h = await warmHarness();
  try {
    await h.control({ loseReserveAcks: 2 });
    const failed = await h.create('twice-lost-allocation'); assert.equal(failed.status, 503); await failed.body?.cancel();
    assert.deepEqual((await h.control()).calls, { refresh: 2, reserve: 2, revoke: 0, reconcile: 0 });
    assert.equal(await h.count(), 0, 'uncertain allocation delivery never authorizes canonical work');
    const lost = (await h.grants())[0];
    assert.equal(lost.holderSeedAttempts, 2); assert.equal(lost.accounted.workerRequests, 16);
    const fresh = await h.create('twice-lost-allocation'); assert.equal(fresh.status, 201); await fresh.body?.cancel();
    const grants = await h.grants();
    assert.equal(grants.length, 2); assert.notEqual(grants[0].holderId, grants[1].holderId);
    assert.equal(grants[0].accounted.workerRequests, 16, 'replacement holder receives a separately charged block');
    assert.deepEqual((await h.control()).calls, { refresh: 3, reserve: 3, revoke: 0, reconcile: 0 });
  } finally { await h.mf.dispose(); }
});

test('warm admission observes current credential and restriction revocation before mutation with zero DO calls', async () => {
  const h = await warmHarness();
  try {
    const first = await h.create('before-revoke'); assert.equal(first.status, 201); await first.body?.cancel();
    const before = await h.control();
    await h.db.prepare("UPDATE api_keys SET is_active=0 WHERE tenant_id='runtime-tenant' AND id='runtime-key'").run();
    const revoked = await h.create('revoked-key'); assert.equal(revoked.status, 401); await revoked.body?.cancel();
    await h.db.prepare("UPDATE api_keys SET is_active=1 WHERE tenant_id='runtime-tenant' AND id='runtime-key'").run();
    const row = await h.db.prepare("SELECT restriction_json FROM budget_tenant_allocations WHERE tenant_id='runtime-tenant'").first<{ restriction_json: string }>();
    const restriction = JSON.parse(row!.restriction_json); restriction.revision = 2;
    await h.db.prepare("UPDATE budget_tenant_allocations SET restriction_json=? WHERE tenant_id='runtime-tenant'").bind(JSON.stringify(restriction)).run();
    const changed = await h.create('changed-restriction'); assert.equal(changed.status, 503); await changed.body?.cancel();
    // A later stale snapshot cannot revive a retired cache entry.
    restriction.revision = 1;
    await h.db.prepare("UPDATE budget_tenant_allocations SET restriction_json=? WHERE tenant_id='runtime-tenant'").bind(JSON.stringify(restriction)).run();
    const stale = await h.create('restored-old-restriction'); assert.equal(stale.status, 503); await stale.body?.cancel();
    assert.equal(await h.count(), 1);
    assert.deepEqual((await h.control()).calls, before.calls);
  } finally { await h.mf.dispose(); }
});

for (const loss of ['discard', 'expiry'] as const) test(`${loss} retains the original central charge; one bounded smaller block can use only remaining capacity`, async () => {
  const owner = policy({ workerRequests: 27, d1RowsRead: 200_000, d1RowsWritten: 100_000,
    doRequests: 100, doRowsRead: 100, doRowsWritten: 100, logEvents: 10_000 });
  if (loss === 'expiry') owner.maxGrantLifetimeMs = 10_000;
  const h = await warmHarness(owner);
  try {
    const first = await h.create(`before-${loss}`); assert.equal(first.status, 201); await first.body?.cancel();
    const initial = (await h.grants())[0];
    assert.equal(initial.accounted.workerRequests, 16);
    await h.control(loss === 'discard' ? { discard: true } : { now: initial.expiresAt + 1 });
    const second = await h.create(`after-${loss}`); assert.equal(second.status, 201); await second.body?.cancel();
    const grants = await h.grants();
    assert.equal(grants.length, 2);
    assert.notEqual(grants[0].holderId, grants[1].holderId);
    assert.equal(grants[0].accounted.workerRequests, 16, 'lost/expired unused balance is not returned');
    assert.equal(grants[1].accounted.workerRequests, 2, 'only the explicit one-operation fallback fits remaining owner capacity');
    if (loss === 'expiry') assert.equal(grants[0].status, 'uncertain');
    assert.deepEqual((await h.control()).calls, { refresh: 3, reserve: 3, revoke: 0, reconcile: 0 }, 'one initial block plus one rejected large block and one bounded fallback');
    assert.equal(await h.count(), 2);
  } finally { await h.mf.dispose(); }
});

test('four eight-operation blocks cap refill work while the owner recovery partition remains available', async () => {
  const h = await warmHarness();
  try {
    for (let index = 0; index < 32; index++) {
      const response = await h.create(`bounded-operation-${index}`); assert.equal(response.status, 201); await response.body?.cancel();
    }
    const before = await h.control();
    assert.deepEqual(before.cache, { scopes: 1, holders: 4, operations: 32, refills: 4 });
    const rejected = await h.create('refill-cap'); assert.equal(rejected.status, 429); await rejected.body?.cancel();
    assert.deepEqual((await h.control()).calls, before.calls, 'refill cap rejects before any further control-plane call');
    assert.equal((await h.grants()).every(grant => grant.purpose === 'new-work'), true);
    const recovery = await h.coordinator.reserveFromTrustedAuthority({ tenantId: 'runtime-tenant', holderId: 'synthetic-recovery-holder',
      idempotencyKey: 'synthetic-recovery', purpose: 'recovery', envelope: { workerRequests: 200 }, expectedPolicyId: 'runtime-owner-policy',
      expectedPolicyRevision: 1, expectedRestrictionRevision: 1, now: h.initialNow + 2 });
    assert.equal(recovery.status, 'granted', 'active new-work blocks never borrow the 20% recovery reserve');
    assert.equal(await h.count(), 32);
  } finally { await h.mf.dispose(); }
});

for (const boundary of [
  { total: 65, ordinary: 64, cache: true, name: 'the shared isolate registry rejects its 65th authorized scope before another DO call' },
  { total: 64, ordinary: 63, cache: false, name: 'native unchanged total64 cap reserves its last slot for real recovery after63 ordinary scopes' },
]) test(boundary.name, async () => {
  const h = await warmHarness(policy({ workerRequests: 10_000, d1RowsRead: 5_000_000, d1RowsWritten: 2_000_000,
    doRequests: 1_000, doRowsRead: 1_000, doRowsWritten: 1_000, logEvents: 1_000_000 }));
  try {
    // The cache-specific case needs64 ordinary slots plus the dedicated recovery
    // slot. The separate total64 case below preserves the default owner ceiling.
    if (boundary.cache) await h.db.prepare('UPDATE budget_owner_policies SET max_reservations=65').run();
    const first = await h.create('scope-fixture'); assert.equal(first.status, 201);
    const firstBody = await first.json() as { id: string };
    const source = await h.db.prepare("SELECT * FROM tickets WHERE tenant_id='runtime-tenant' AND id=?").bind(firstBody.id).first<Record<string, unknown>>();
    assert.ok(source);
    const targets = Array.from({ length: 64 }, () => crypto.randomUUID());
    const columns = Object.keys(source);
    // Synthetic authorized targets only; all normal reply authentication and
    // canonical mutation code still runs for the requests below.
    await h.db.batch(targets.map((target, index) => {
      const ticket = { ...source, id: target, ticket_no: index + 2 };
      return h.db.prepare(`INSERT INTO tickets (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
        .bind(...columns.map(column => ticket[column]));
    }));
    const reply = (target: string) => h.mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${target}/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify({ body: 'synthetic bounded scope' }),
    });
    for (const target of targets.slice(0, boundary.ordinary - 1)) {
      const response = await reply(target);
      assert.equal(response.status, 201); await response.body?.cancel();
    }
    const before = await h.control();
    assert.equal(before.cache.scopes, boundary.ordinary);
    console.log('scope-capacity-evidence', { scopes: before.cache.scopes,
      storedBytes: new TextEncoder().encode(encodeCoordinatorState(await h.coordinatorState())).byteLength });
    const rejected = await reply(targets[boundary.ordinary - 1]); assert.equal(rejected.status, 429); await rejected.body?.cancel();
    if (boundary.cache) assert.deepEqual((await h.control()).calls, before.calls);
    else {
      assert.ok((await h.control()).calls.reserve > before.calls.reserve, 'owner slot exhaustion is checked by the coordinator');
      assert.equal((await h.grants()).filter(grant => !grant.compacted).length, 63);
      await h.control({ now: h.initialNow + 30_001 });
      const recovered = await h.create('ordinary63-after-recovery'); assert.equal(recovered.status, 201); await recovered.body?.cancel();
      const tenant = (await h.coordinatorState()).tenantStates[0];
      assert.equal(tenant.closedCharges.find(charge => charge.dimension === 'workerRequests' && charge.purpose === 'recovery')?.units, 2);
      assert.ok(tenant.grants.filter(grant => !grant.compacted).length <= boundary.total);
      assert.equal((await h.control()).calls.reconcile, 1);
    }
    assert.equal((await h.db.prepare("SELECT count(*) AS count FROM articles WHERE tenant_id='runtime-tenant' AND ticket_id=?").bind(targets[boundary.ordinary - 1]).first<{ count: number }>())?.count, 0);
  } finally { await h.mf.dispose(); }
});

test('two live tenant credentials retain separate warm grants and wrong-tenant targets have no side effects', async () => {
  const h = await warmHarness(undefined, 1);
  try {
    const otherKey = `lt_budget_other.${randomBytes(32).toString('hex')}`;
    await h.db.prepare(`INSERT INTO api_keys (tenant_id,id,name,key_hash,prefix,permissions,is_active,created_at)
      VALUES ('runtime-extra-000','runtime-other-key','synthetic other',?,'lt_budget','tickets:write',1,unixepoch())`)
      .bind(await credentialDigest(otherKey)).run();
    const first = await h.create('colliding-key'); assert.equal(first.status, 201); const ticket = await first.json() as { id: string };
    const second = await h.create('colliding-key', 'other tenant canonical work', otherKey); assert.equal(second.status, 201); await second.body?.cancel();
    assert.equal((await h.control()).cache.scopes, 2);
    const before = await h.control();
    const denied = await h.mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${ticket.id}/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': otherKey }, body: JSON.stringify({ body: 'must not commit' }),
    });
    assert.equal(denied.status, 404); await denied.body?.cancel();
    assert.deepEqual((await h.control()).calls, before.calls);
    assert.equal((await h.db.prepare("SELECT count(*) AS count FROM articles WHERE tenant_id='runtime-extra-000'").first<{ count: number }>())?.count, 1);
    assert.equal((await h.grants()).length, 2);
  } finally { await h.mf.dispose(); }
});

test('real local API creates and same-ticket replies reuse prepaid blocks without warm DO calls', async () => {
  const bundled = await build({ entryPoints: [resolve(import.meta.dirname, 'budget-admission-runtime-entry.ts')], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'budget-admission-multiple-grants-proof', modules: true, compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
      bindings: { BUDGET_ADMISSION_POLICY: 'api-ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true' },
      d1Databases: { DB: 'budget-admission-multiple-grants-d1' },
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' }, unsafeEphemeralDurableObjects: true,
    }] }));
    const db = await mf.getD1Database('DB');
    await applyMigrations(db);
    await seed(db, 0, policy({ workerRequests: 40, d1RowsRead: 120_000, d1RowsWritten: 100_000,
      doRequests: 40, doRowsWritten: 40, doRowsRead: 40, logEvents: 10_000 }));
    const request = (subject: string, key: string) => mf!.dispatchFetch('http://runtime.test/api/v1/tickets', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'idempotency-key': key },
      body: JSON.stringify({ subject, customer_email: 'runtime@example.test', body: 'synthetic' }),
    });
    const first = await request('First independently budgeted ticket', 'multiple-create-1');
    const firstControl = await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as any;
    const second = await request('Second independently budgeted ticket', 'multiple-create-2');
    assert.deepEqual((await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as any).calls, firstControl.calls, 'warm create performs zero DO calls');
    assert.equal(first.status, 201); assert.equal(second.status, 201);
    const firstTicket = await first.json() as { id: string };
    const secondTicket = await second.json() as { id: string };
    const reply = (ticketId: string, body: string, key: string) => mf!.dispatchFetch(`http://runtime.test/api/v1/tickets/${ticketId}/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'idempotency-key': key }, body: JSON.stringify({ body }),
    });
    const firstReply = await reply(firstTicket.id, 'first independently budgeted reply', 'multiple-reply-1');
    const replyControl = await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as any;
    const secondReply = await reply(firstTicket.id, 'second independently budgeted reply', 'multiple-reply-2');
    assert.equal(firstReply.status, 201); assert.equal(secondReply.status, 201);
    assert.deepEqual((await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as any).calls, replyControl.calls, 'warm exact-target reply performs zero DO calls');
    await Promise.all([firstReply.body?.cancel(), secondReply.body?.cancel()]);

    const replay = await reply(firstTicket.id, 'first independently budgeted reply', 'multiple-reply-1');
    assert.equal(replay.status, 201, 'the canonical replay must not create a fifth budget grant');
    await replay.body?.cancel();

    const snapshot = await new BudgetAuthorityRepository(db).resolveForVerifiedPrincipal(
      createVerifiedTenantScope('runtime-tenant', 'runtime-key', ['integration'], 1),
      { kind: 'api-key', apiKeyId: 'runtime-key', requiredPermission: 'tickets:write' }, now,
    );
    assert.equal(snapshot.kind, 'active');
    if (snapshot.kind !== 'active') throw new Error('expected active synthetic authority');
    const coordinators = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const coordinator = coordinators.get(coordinators.idFromName(snapshot.authority.aggregateId)) as unknown as BudgetCoordinatorDO;
    const grants = (await coordinator.inspectForTrustedRuntime()).tenantStates.find(state => state.tenantId === 'runtime-tenant')?.grants ?? [];
    assert.equal(grants.length, 2, 'creates share one block and same-ticket replies share another');
    assert.equal(new Set(grants.map(grant => grant.reservationId)).size, 2);
    const holders = await mf.getDurableObjectNamespace('BUDGET_GRANT_HOLDER_DO') as unknown as DurableObjectNamespace<BudgetGrantHolderDO>;
    for (const grant of grants) {
      const holder = holders.get(holders.idFromName(JSON.stringify([
        'budget-grant-holder-v2', 'runtime-tenant', grant.holderId, grant.reservationId,
      ]))) as any;
      const stored = await holder.inspectForTrustedRuntime();
      assert.equal(stored, null, 'an isolate grant is never also seeded into a durable holder');
    }
    assert.equal((await db.prepare("SELECT count(*) AS count FROM tickets WHERE tenant_id='runtime-tenant'").first<{ count: number }>())?.count, 2);
    assert.equal((await db.prepare("SELECT count(*) AS count FROM articles WHERE tenant_id='runtime-tenant'").first<{ count: number }>())?.count, 4);
  } finally { await mf?.dispose(); }
});


test('full 128-allocation authority that exceeds the bounded DO payload fails closed before mutation', async () => {
  const bundled = await build({ entryPoints: [resolve(import.meta.dirname, 'budget-admission-runtime-entry.ts')], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'budget-admission-oversize-proof', modules: true, compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
      bindings: { BUDGET_ADMISSION_POLICY: 'api-ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true' },
      d1Databases: { DB: 'budget-admission-oversize-d1' },
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' }, unsafeEphemeralDurableObjects: true,
    }] }));
    const db = await mf.getD1Database('DB'); await applyMigrations(db); await seed(db, 127);
    const resolution = await new BudgetAuthorityRepository(db).resolveForVerifiedPrincipal(
      createVerifiedTenantScope('runtime-tenant', 'runtime-key', ['integration'], 1),
      { kind: 'api-key', apiKeyId: 'runtime-key', requiredPermission: 'tickets:write' }, now,
    );
    assert.equal(resolution.kind, 'unavailable', 'oversized configured authority never reaches a coordinator RPC');
    const response = await mf.dispatchFetch('http://runtime.test/api/v1/tickets', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ subject: 'must not commit', customer_email: 'runtime@example.test', body: 'synthetic' }),
    });
    assert.equal(response.status, 503);
    await response.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) AS count FROM tickets WHERE tenant_id='runtime-tenant'").first<{ count: number }>())?.count, 0);
  } finally { await mf?.dispose(); }
});

for (const operation of ['create','reply','update'] as const) for (const change of ['authority','policy','window','restriction','key','permission','expiry'] as const) {
  test(`active API ${operation} fences ${change} after admission before canonical commit`,async()=>{
    const h=await warmHarness();try{
      const seedResponse=await h.create('fence-target');assert.equal(seedResponse.status,201);
      const target=await seedResponse.json() as {id:string};
      if(change==='expiry') {
        await h.control({discard:true,now:Date.now()});
        await h.db.prepare('UPDATE budget_owner_policies SET authority_max_age_ms=1000').run();
      }
      const counts=async()=>{
        const result:Record<string,number>={};for(const table of ['tickets','articles','attachments','conversation_events','ticket_sla_events','ticket_mutation_receipts','budget_grant_operations']) {
          result[table]=(await h.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE tenant_id='runtime-tenant'`).first<{n:number}>())!.n;
        }return result;
      };
      const before=await counts();
      await h.control(change==='expiry'?{canonicalDelayMs:1100}:{beforeCanonical:change});
      const response=operation==='create'?await h.create('fenced'):operation==='reply'?await h.mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${target.id}/articles`,{
        method:'POST',headers:{'content-type':'application/json','x-api-key':apiKey,'idempotency-key':'fenced'},body:JSON.stringify({body:'Fenced reply',sender_type:'agent'}),
      }):await h.mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${target.id}`,{
        method:'PATCH',headers:{'content-type':'application/json','x-api-key':apiKey,'idempotency-key':'fenced'},body:JSON.stringify({status:'pending'}),
      });
      assert.ok([401,403,503].includes(response.status),`expected fenced failure, received ${response.status}`);await response.body?.cancel();
      assert.deepEqual(await counts(),before);assert.ok((await h.grants()).every(grant=>grant.accounted.workerRequests!>0),'denial never refunds accepted grants');
    }finally{await h.mf.dispose();}
  });
}

test('active API create/reply recover one same-key failed or unacknowledged batch without another grant or duplicate canonical work',async()=>{
  const h=await warmHarness();try{
    const targetResponse=await h.create('recovery-target');const target=await targetResponse.json() as {id:string};
    const reply=(key:string)=>h.mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${target.id}/articles`,{
      method:'POST',headers:{'content-type':'application/json','x-api-key':apiKey,'idempotency-key':key},body:JSON.stringify({body:'Recovery reply'}),
    });
    for(const [name,send] of [['create',()=>h.create('recover-create')],['reply',()=>reply('recover-reply')]] as const){
      await h.control({beforeCanonical:'failure'});const failed=await send();assert.equal(failed.status,503);await failed.body?.cancel();
      const charged=(await h.control()).calls;const recovered=await send();assert.equal(recovered.status,201);await recovered.body?.cancel();
      assert.deepEqual((await h.control()).calls,charged,`${name} recovery uses its bounded local receipt`);
      const before=await h.control();const replayed=await send();assert.equal(replayed.status,201);assert.equal(replayed.headers.get('Idempotency-Replayed'),'true');await replayed.body?.cancel();
      assert.deepEqual((await h.control()).calls,before.calls);assert.deepEqual((await h.control()).canonicalBatches,before.canonicalBatches);
    }
    await h.control({loseCanonicalAck:true});const lost=await h.create('lost-ack');assert.equal(lost.status,201);assert.equal(lost.headers.get('Idempotency-Replayed'),'true');await lost.body?.cancel();
    assert.equal(await h.count(),3);
  }finally{await h.mf.dispose();}
});

test('active API PATCH admits one current-key fenced update and recovers its 200 receipt without another grant',async()=>{
  const h=await warmHarness();try{
    const created=await h.create('update-admission-target');assert.equal(created.status,201);const target=await created.json() as {id:string};
    const update=(key:string,body:object)=>h.mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${target.id}`,{
      method:'PATCH',headers:{'content-type':'application/json','x-api-key':apiKey,'idempotency-key':key},body:JSON.stringify(body),
    });
    const before=await h.control();
    const first=await update('update-admission-retry',{status:'pending'});assert.equal(first.status,200);assert.equal(first.headers.get('Idempotency-Replayed'),'false');await first.body?.cancel();
    const charged=await h.control();assert.ok(charged.canonicalBatches>before.canonicalBatches,'The admitted PATCH enters one canonical D1 batch');
    const replay=await update('update-admission-retry',{status:'pending'});assert.equal(replay.status,200);assert.equal(replay.headers.get('Idempotency-Replayed'),'true');await replay.body?.cancel();
    assert.deepEqual((await h.control()).calls,charged.calls,'Receipt replay reuses the warm bounded grant');
    assert.equal((await h.db.prepare("SELECT count(*) AS n FROM ticket_mutation_receipts WHERE tenant_id='runtime-tenant' AND operation='api.ticket.update'").first<{n:number}>())?.n,1);
    assert.equal((await h.db.prepare("SELECT count(*) AS n FROM conversation_events WHERE tenant_id='runtime-tenant' AND ticket_id=? AND kind='ticket.state_changed'").bind(target.id).first<{n:number}>())?.n,1);
    const conflict=await update('update-admission-retry',{status:'resolved'});assert.equal(conflict.status,409);await conflict.body?.cancel();
  }finally{await h.mf.dispose();}
});

test('native API canonical metadata includes worst-case 100-receipt cleanup and current-public-history projection writes',async()=>{
  const h=await warmHarness();try{
    const first=await h.create('metadata-seed');const target=await first.json() as {id:string};
    for(const operation of ['create','reply','update'] as const){
      const key=`measure-${operation}`,hash=await credentialDigest(key);
      await h.db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<150)
        INSERT INTO ticket_mutation_receipts (tenant_id,principal_kind,principal_id,operation,key_hash,payload_hash,fingerprint_version,response_version,
          result_ticket_id,result_article_id,response_status,response_snapshot,created_at,expires_at)
        SELECT tenant_id,principal_kind,principal_id,?,CASE WHEN x=1 THEN ? ELSE printf('%064d',x) END,payload_hash,fingerprint_version,response_version,
          result_ticket_id,result_article_id,response_status,response_snapshot,unixepoch()-100,unixepoch()-1
        FROM ticket_mutation_receipts,n WHERE tenant_id='runtime-tenant' AND key_hash=?`).bind(`api.ticket.${operation}`,hash,await credentialDigest('metadata-seed')).run();
      const response=operation==='create'?await h.create(key):operation==='reply'?await h.mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${target.id}/articles`,{
        method:'POST',headers:{'content-type':'application/json','x-api-key':apiKey,'idempotency-key':key},body:JSON.stringify({body:'Measured first public staff response',sender_type:'agent'}),
      }):await h.mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${target.id}`,{
        method:'PATCH',headers:{'content-type':'application/json','x-api-key':apiKey,'idempotency-key':key},body:JSON.stringify({status:'pending'}),
      });
      assert.equal(response.status,operation==='update'?200:201);await response.body?.cancel();
      const measured=(await h.control()).canonicalBatches.at(-1);
      console.log(JSON.stringify({fixture:'native-d1-canonical-metadata',operation,...measured}));
      assert.ok(measured.rowsWritten>100);assert.ok(measured.rowsRead>0);
      assert.ok(measured.rowsWritten<=CANONICAL_MUTATION_ATTEMPT_D1_WRITES);
      assert.ok(2*measured.rowsWritten<=CANONICAL_MUTATION_D1_WRITES);
      const projectionIndexes=await h.db.prepare('PRAGMA index_list(conversation_public_history)').all();
      assert.equal(projectionIndexes.results.length,2,'projection primary/sequence indexes are included in the canonical write inventory');
      assert.ok(100*5+50*9+4<=CANONICAL_MUTATION_ATTEMPT_D1_WRITES);
    }
  }finally{await h.mf.dispose();}
});

test('five concurrent and successive API retries cannot exceed two canonical attempts per charged operation across fresh prepared tokens',async()=>{
  const h=await warmHarness();try{
    for(const cycle of [0,1]){
      if(cycle) await h.control({discard:true});
      await h.control({failCanonicalAttempts:5});
      const before=(await h.control()).canonicalAttempts;
      const responses=await Promise.all(Array.from({length:5},()=>h.create('bounded-failure')));
      assert.deepEqual(responses.map(response=>response.status),[503,503,503,503,503]);await Promise.all(responses.map(response=>response.body?.cancel()));
      for(let i=0;i<3;i++){const denied=await h.create('bounded-failure');assert.equal(denied.status,503);await denied.body?.cancel();}
      assert.equal((await h.control()).canonicalAttempts-before,2,'holder counter outlives individual prepared tokens');
      assert.equal(await h.count(),0);
      const grants=await h.grants();assert.equal(grants.length,cycle+1);assert.ok(grants.every(grant=>grant.accounted.workerRequests===16));
      if(cycle)assert.notEqual(grants[0].holderId,grants[1].holderId,'lost isolate needs another fully charged grant');
    }
  }finally{await h.mf.dispose();}
});


for (const operation of ['create','reply'] as const) for (const change of ['policy','restriction','source-format','authority-lifetime'] as const) {
  test(`warm API ${operation} invalidates an exact ${change} source edit with unchanged revisions`,async()=>{
    const h=await warmHarness();try{
      const target=await (await h.create('snapshot-target')).json() as {id:string};
      const send=(key:string)=>operation==='create'?h.create(key):h.mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${target.id}/articles`,{
        method:'POST',headers:{'content-type':'application/json','x-api-key':apiKey,'idempotency-key':key},body:JSON.stringify({body:'Snapshot reply'}),
      });
      const warm=await send('snapshot-warm');assert.equal(warm.status,201);await warm.body?.cancel();
      const originalPolicy=await h.db.prepare('SELECT policy_json,authority_max_age_ms FROM budget_owner_policies').first<{policy_json:string;authority_max_age_ms:number}>();
      const originalRestriction=await h.db.prepare("SELECT restriction_json FROM budget_tenant_allocations WHERE tenant_id='runtime-tenant'").first<{restriction_json:string}>();
      const before=await h.control(),grants=await h.grants();
      const edits={
        policy:"UPDATE budget_owner_policies SET policy_json=json_set(policy_json,'$.budgets[0].recoveryPercent',21)",
        restriction:"UPDATE budget_tenant_allocations SET restriction_json=json_set(restriction_json,'$.limits.workerRequests',999) WHERE tenant_id='runtime-tenant'",
        'source-format':"UPDATE budget_owner_policies SET policy_json=policy_json||' '",
        'authority-lifetime':'UPDATE budget_owner_policies SET authority_max_age_ms=59000',
      };
      await h.db.prepare(edits[change]).run();
      const authority=await new BudgetAuthorityRepository(h.db).resolveForVerifiedPrincipal(createVerifiedTenantScope('runtime-tenant','runtime-key',['integration'],1),
        {kind:'api-key',apiKeyId:'runtime-key',requiredPermission:'tickets:write'},h.initialNow);
      assert.equal(authority.kind,'active','edited authority remains valid; rejection must be cache consistency');
      if(authority.kind!=='active')throw new Error('Expected synthetic active authority');
      assert.equal(authority.authority.authorityRevision,1);assert.equal(authority.authority.ownerPolicy.revision,1);
      assert.equal(authority.authority.tenantAllocations[0].effectivePolicy.restrictionRevision,1);
      const denied=await send('snapshot-denied');assert.equal(denied.status,503);await denied.body?.cancel();
      assert.deepEqual((await h.control()).calls,before.calls);assert.equal((await h.control()).canonicalAttempts,before.canonicalAttempts);
      assert.deepEqual(await h.grants(),grants,'retiring a holder does not release its prepaid charge');
      await h.db.batch([
        h.db.prepare('UPDATE budget_owner_policies SET policy_json=?,authority_max_age_ms=?').bind(originalPolicy!.policy_json,originalPolicy!.authority_max_age_ms),
        h.db.prepare("UPDATE budget_tenant_allocations SET restriction_json=? WHERE tenant_id='runtime-tenant'").bind(originalRestriction!.restriction_json),
      ]);
      const recovered=await send('snapshot-denied');assert.equal(recovered.status,201);await recovered.body?.cancel();
      const renewed=await h.control(),newGrants=await h.grants();assert.equal(newGrants.length,grants.length+1);
      assert.ok(newGrants.some(grant=>!grants.some(old=>old.holderId===grant.holderId)),'restored source needs a new paid holder');
      for(const old of grants)assert.deepEqual(newGrants.find(grant=>grant.holderId===old.holderId)?.accounted,old.accounted);
      const replay=await send('snapshot-warm');assert.equal(replay.status,201);assert.equal(replay.headers.get('Idempotency-Replayed'),'true');await replay.body?.cancel();
      assert.deepEqual((await h.control()).calls,renewed.calls);assert.equal((await h.control()).canonicalAttempts,renewed.canonicalAttempts);
    }finally{await h.mf.dispose();}
  });
}

test('cold allocation source edits retire the newly charged holder before its first local spend',async()=>{
  const h=await warmHarness();try{
    await h.control({editPolicyAfterReserve:true});
    const denied=await h.create('changed-during-cold-grant');assert.equal(denied.status,503);await denied.body?.cancel();
    const after=await h.control();assert.deepEqual(after.calls,{refresh:1,reserve:1,revoke:0,reconcile:0});
    assert.equal(after.cache.operations,0);assert.equal(after.canonicalAttempts,0);assert.equal(await h.count(),0);
    const grants=await h.grants();assert.equal(grants.length,1);assert.equal(grants[0].accounted.workerRequests,16);
    const retry=await h.create('changed-during-cold-grant');assert.equal(retry.status,201);await retry.body?.cancel();
    assert.deepEqual((await h.control()).calls,{refresh:2,reserve:2,revoke:0,reconcile:0});
    const renewed=await h.grants();assert.equal(renewed.length,2);assert.notEqual(renewed[0].holderId,renewed[1].holderId);
    assert.deepEqual(renewed[0].accounted,grants[0].accounted);
  }finally{await h.mf.dispose();}
});

async function advanceRuntimePolicy(h:Awaited<ReturnType<typeof warmHarness>>,revision:number,endsAt?:number) {
  const row=await h.db.prepare('SELECT policy_json FROM budget_owner_policies').first<{policy_json:string}>();
  const policy=JSON.parse(row!.policy_json);policy.revision=revision;
  if(endsAt!==undefined)for(const budget of policy.budgets)budget.window={...budget.window,id:`runtime-window-${revision}`,endsAt};
  await h.db.batch([
    h.db.prepare('UPDATE budget_deployment_authority SET authority_revision=?').bind(revision),
    h.db.prepare('INSERT INTO budget_owner_policies SELECT deployment_id,policy_id,?,?,coordinator_id,max_reservations,authority_max_age_ms,? FROM budget_owner_policies LIMIT 1').bind(revision,revision,JSON.stringify(policy)),
    h.db.prepare("UPDATE budget_tenant_allocations SET policy_revision=?,authority_revision=?,restriction_json=json_set(restriction_json,'$.ownerPolicyRevision',?,'$.revision',?)").bind(revision,revision,revision,revision),
    h.db.prepare('DELETE FROM budget_owner_policies WHERE policy_revision<>?').bind(revision),
  ]);
}

test('valid current source renewal shares one new paid grant and then restores zero-DO warm work',async()=>{
  const h=await warmHarness();try{
    const first=await h.create('before-renewal');assert.equal(first.status,201);await first.body?.cancel();
    const original=(await h.grants())[0];
    await h.db.prepare("UPDATE budget_owner_policies SET policy_json=policy_json||' '").run();
    const detecting=await h.create('after-renewal');assert.equal(detecting.status,503);await detecting.body?.cancel();
    const responses=await Promise.all(Array.from({length:5},(_,i)=>h.create(`renewal-${i}`)));
    assert.deepEqual(responses.map(response=>response.status),[201,201,201,201,201]);await Promise.all(responses.map(response=>response.body?.cancel()));
    const before=await h.control(),grants=await h.grants();
    assert.equal(grants.length,2);assert.notEqual(grants[1].holderId,original.holderId);assert.deepEqual(grants[0].accounted,original.accounted);
    assert.deepEqual(before.calls,{refresh:2,reserve:2,revoke:0,reconcile:0});assert.equal(before.cache.refills,2);assert.equal(before.cache.scopes,1);
    const warm=await h.create('warm-renewal');assert.equal(warm.status,201);await warm.body?.cancel();
    const replay=await h.create('before-renewal');assert.equal(replay.status,201);assert.equal(replay.headers.get('Idempotency-Replayed'),'true');await replay.body?.cancel();
    assert.deepEqual((await h.control()).calls,before.calls);
  }finally{await h.mf.dispose();}
});

test('monotonic policy renewal retains old charges and honors new authority',async()=>{
  const h=await warmHarness();try{
    const initial=await h.create('old-policy');assert.equal(initial.status,201);await initial.body?.cancel();
    const old=(await h.grants())[0];await advanceRuntimePolicy(h,2);
    const detecting=await h.create('new-policy');assert.equal(detecting.status,503);await detecting.body?.cancel();
    const current=await h.create('new-policy');assert.equal(current.status,201);await current.body?.cancel();
    const grants=await h.grants();assert.equal(grants.length,2);assert.equal(grants[1].policyRevision,2);
    assert.deepEqual(grants[0].accounted,old.accounted);assert.equal(grants[0].status,'uncertain');assert.notEqual(grants[1].holderId,old.holderId);
    assert.equal((await h.control()).cache.refills,2);
    const calls=(await h.control()).calls;const warm=await h.create('new-policy-warm');assert.equal(warm.status,201);await warm.body?.cancel();
    assert.deepEqual((await h.control()).calls,calls);
  }finally{await h.mf.dispose();}
});

for(const expired of [false,true])test(`late old allocation cannot install or overlap a replacement generation${expired?' across interval reset':''}`,async()=>{
  const h=await warmHarness();let pending:ReturnType<typeof h.create>|undefined;
  try{
    await h.control({pauseNextReserve:true});pending=h.create('late-old');
    let paused=false;for(let attempt=0;attempt<100;attempt++){
      if((await h.control()).reservePaused){paused=true;break;}await new Promise(resolve=>setTimeout(resolve,5));
    }assert.equal(paused,true);
    if(expired){
      const policy=JSON.parse((await h.db.prepare('SELECT policy_json FROM budget_owner_policies').first<{policy_json:string}>())!.policy_json);
      const boundary=policy.budgets[0].window.endsAt;
      await advanceRuntimePolicy(h,2,boundary+60_000);await h.control({now:boundary+1});
    }else await h.db.prepare("UPDATE budget_owner_policies SET policy_json=policy_json||' '").run();
    for(let attempt=0;attempt<3;attempt++){
      const rejected=await h.create('replacement');assert.equal(rejected.status,503);await rejected.body?.cancel();
    }
    assert.deepEqual((await h.control()).calls,{refresh:1,reserve:1,revoke:0,reconcile:0});assert.equal((await h.control()).cache.scopes,1);
    await h.control({releaseReserve:true});const old=await pending;pending=undefined;assert.equal(old.status,503);await old.body?.cancel();
    const retired=await h.control();assert.equal(retired.cache.holders,0);assert.equal(retired.cache.operations,0);assert.equal(retired.canonicalAttempts,0);
    const recovered=await h.create('replacement');assert.equal(recovered.status,201);await recovered.body?.cancel();
    const grants=await h.grants();assert.equal(grants.length,2);assert.notEqual(grants[0].holderId,grants[1].holderId);
    assert.ok(grants.every(grant=>grant.accounted.workerRequests===16));assert.equal((await h.control()).cache.refills,expired?1:2);
  }finally{await h.control({releaseReserve:true});if(pending)await (await pending).body?.cancel();await h.mf.dispose();}
});

test('policy renewal cannot reset four refill credits or the two canonical attempts per paid operation',async()=>{
  const h=await warmHarness();try{
    for(let generation=0;generation<4;generation++){
      if(generation){
        await h.db.prepare("UPDATE budget_owner_policies SET policy_json=policy_json||' '").run();
        const detecting=await h.create('failed-renewal');assert.equal(detecting.status,503);await detecting.body?.cancel();
      }
      await h.control({failCanonicalAttempts:5});const before=(await h.control()).canonicalAttempts;
      for(let attempt=0;attempt<5;attempt++){
        const failed=await h.create('failed-renewal');assert.equal(failed.status,503);await failed.body?.cancel();
      }
      assert.equal((await h.control()).canonicalAttempts-before,2);assert.equal((await h.control()).cache.refills,generation+1);
      const grants=await h.grants();assert.equal(grants.length,generation+1);assert.ok(grants.every(grant=>grant.accounted.workerRequests===16));
    }
    const calls=(await h.control()).calls;
    await h.db.prepare("UPDATE budget_owner_policies SET policy_json=policy_json||' '").run();
    const detecting=await h.create('failed-renewal');assert.equal(detecting.status,503);await detecting.body?.cancel();
    for(let attempt=0;attempt<5;attempt++){
      const exhausted=await h.create('failed-renewal');assert.equal(exhausted.status,429);await exhausted.body?.cancel();
    }
    assert.deepEqual((await h.control()).calls,calls);assert.equal((await h.control()).cache.refills,4);assert.equal(await h.count(),0);
    assert.equal(new Set((await h.grants()).map(grant=>grant.holderId)).size,4);
  }finally{await h.mf.dispose();}
});

test('shorter replacement windows cannot erase refill accounting before the retained interval boundary',async()=>{
  const h=await warmHarness();try{
    const first=await h.create('horizon-1');assert.equal(first.status,201);await first.body?.cancel();
    const original=JSON.parse((await h.db.prepare('SELECT policy_json FROM budget_owner_policies').first<{policy_json:string}>())!.policy_json);
    const originalEnd=original.budgets[0].window.endsAt;
    await advanceRuntimePolicy(h,2,h.initialNow+20_000);
    const detecting=await h.create('horizon-2');assert.equal(detecting.status,503);await detecting.body?.cancel();
    const second=await h.create('horizon-2');assert.equal(second.status,201);await second.body?.cancel();
    assert.equal((await h.control()).cache.refills,2);
    await h.control({now:h.initialNow+21_000});await advanceRuntimePolicy(h,3,originalEnd-1_000);
    const stillAccounted=await h.create('horizon-3');assert.equal(stillAccounted.status,503);await stillAccounted.body?.cancel();
    const third=await h.create('horizon-3');assert.equal(third.status,201);await third.body?.cancel();
    assert.equal((await h.control()).cache.refills,3);assert.equal((await h.grants()).length,3);
    await h.control({now:originalEnd+1});await advanceRuntimePolicy(h,4,originalEnd+60_000);
    const rollover=await h.create('horizon-4');assert.equal(rollover.status,201);await rollover.body?.cancel();
    assert.equal((await h.control()).cache.refills,1,'a real elapsed interval can start a new ledger');
    const grants=await h.grants();assert.equal(grants.length,4);assert.ok(grants.every(grant=>grant.accounted.workerRequests===16));
  }finally{await h.mf.dispose();}
});

test('policy identity replacement can start at revision one without erasing old identity rollback floors',async()=>{
  const h=await warmHarness();try{
    await advanceRuntimePolicy(h,7);
    const first=await h.create('identity-old');assert.equal(first.status,201);await first.body?.cancel();
    const old=(await h.grants())[0];
    const original=JSON.parse((await h.db.prepare('SELECT policy_json FROM budget_owner_policies').first<{policy_json:string}>())!.policy_json);
    const policy={...original,policyId:'replacement-policy',revision:1,budgets:original.budgets.map((budget:any)=>({...budget,allocationId:`replacement-${budget.dimension}`}))};
    await h.db.batch([
      h.db.prepare("INSERT INTO budget_owner_policies SELECT deployment_id,'replacement-policy',1,8,'replacement-coordinator',max_reservations,authority_max_age_ms,? FROM budget_owner_policies LIMIT 1").bind(JSON.stringify(policy)),
      h.db.prepare('UPDATE budget_deployment_authority SET authority_revision=8'),
      h.db.prepare("UPDATE budget_tenant_allocations SET policy_id='replacement-policy',policy_revision=1,authority_revision=8,restriction_json=json_set(restriction_json,'$.ownerPolicyId','replacement-policy','$.ownerPolicyRevision',1,'$.revision',1)"),
    ]);
    const detecting=await h.create('identity-new');assert.equal(detecting.status,503);await detecting.body?.cancel();
    const replacement=await h.create('identity-new');assert.equal(replacement.status,201);await replacement.body?.cancel();
    const namespace=await h.mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const coordinator=namespace.get(namespace.idFromName('replacement-coordinator')) as unknown as BudgetCoordinatorDO;
    const fresh=(await coordinator.inspectForTrustedRuntime()).tenantStates[0].grants[0];
    assert.equal(fresh.policyRevision,1);assert.notEqual(fresh.holderId,old.holderId);
    assert.ok(fresh.allocations.every(allocation=>allocation.allocationId.startsWith('replacement-')),'new coordinator uses distinct owner allocation identities');
    assert.deepEqual((await h.grants())[0].accounted,old.accounted);assert.equal((await h.control()).cache.refills,2);
    const calls=(await h.control()).calls;
    await h.db.batch([
      h.db.prepare("INSERT INTO budget_owner_policies SELECT deployment_id,policy_id,6,9,coordinator_id,max_reservations,authority_max_age_ms,? FROM budget_owner_policies WHERE policy_id='runtime-owner-policy' AND policy_revision=7").bind(JSON.stringify({...original,revision:6})),
      h.db.prepare('UPDATE budget_deployment_authority SET authority_revision=9'),
      h.db.prepare("UPDATE budget_tenant_allocations SET policy_id='runtime-owner-policy',policy_revision=6,authority_revision=9,restriction_json=json_set(restriction_json,'$.ownerPolicyId','runtime-owner-policy','$.ownerPolicyRevision',6,'$.revision',6)"),
    ]);
    const rollback=await h.create('identity-rollback');assert.equal(rollback.status,503);await rollback.body?.cancel();
    assert.deepEqual((await h.control()).calls,calls,'old identity revision floor rejects before coordinator work');
    // Restore the still-current replacement policy. The rejected older identity
    // did not mutate or retire its valid holder.
    await h.db.batch([
      h.db.prepare('UPDATE budget_deployment_authority SET authority_revision=8'),
      h.db.prepare("UPDATE budget_tenant_allocations SET policy_id='replacement-policy',policy_revision=1,authority_revision=8,restriction_json=json_set(restriction_json,'$.ownerPolicyId','replacement-policy','$.ownerPolicyRevision',1,'$.revision',1)"),
    ]);
    const warm=await h.create('identity-still-warm');assert.equal(warm.status,201);await warm.body?.cancel();
    assert.deepEqual((await h.control()).calls,calls);
  }finally{await h.mf.dispose();}
});

test('native byte capacity rejects new growth before storage and preserves headroom for an accepted API grant recovery', async () => {
  const h = await warmHarness(policy({ workerRequests: 100_000, d1RowsRead: 1_000_000, d1RowsWritten: 100_000,
    doRequests: 1_000, doRowsRead: 1_000, doRowsWritten: 1_000, logEvents: 100_000 }));
  try {
    await h.db.prepare('UPDATE budget_owner_policies SET max_reservations=4096').run();
    const response = await h.create('byte-headroom-accepted'); assert.equal(response.status, 201); await response.body?.cancel();
    let rejected = false;
    for (let index = 0; index < 512; index++) {
      const before = JSON.stringify(await h.coordinatorState());
      try {
        const result = await h.coordinator.reserveFromTrustedAuthority({ tenantId: 'runtime-tenant', holderId: `metadata-${index}-${'€'.repeat(80)}`, idempotencyKey: `metadata-${index}-${'€'.repeat(80)}`,
          expectedPolicyId: 'runtime-owner-policy', expectedPolicyRevision: 1, expectedRestrictionRevision: 1, purpose: 'recovery', envelope: { workerRequests: 1 }, now: h.initialNow });
        if (result.status === 'rejected') {
          assert.equal(result.reason, 'capacity-exhausted');
          assert.equal(JSON.stringify(await h.coordinatorState()), before, 'rejection precedes a durable write');
          rejected = true; break;
        }
        assert.equal(result.status, 'granted');
      } catch (error) {
        assert.match(String(error), /metadata recovery headroom capacity exhausted/);
        assert.equal(JSON.stringify(await h.coordinatorState()), before, 'rejection precedes a durable write');
        rejected = true; break;
      }
    }
    assert.equal(rejected, true, 'bounded synthetic metadata reaches the explicit growth ceiling');
    const beforeRecoveryBytes = new TextEncoder().encode(encodeCoordinatorState(await h.coordinatorState())).byteLength;
    const { sealed, recovery } = await sealedFixture(h);
    assert.equal(await recovery.recover(sealed, h.initialNow + 1), 'reconciled', 'already accepted work can reserve recovery and persist both certified completions');
    const state = await h.coordinatorState();
    const tenant = state.tenantStates[0];
    assert.equal(tenant.grants.find(grant => grant.reservationId === sealed.reservationId)?.compacted, true);
    const paired = tenant.grants.find(grant => grant.recoversReservationId === sealed.reservationId)!;
    assert.equal(paired.compacted, true);
    assert.deepEqual(paired.accounted, paired.envelope);
    const afterRecoveryBytes = new TextEncoder().encode(encodeCoordinatorState(state)).byteLength;
    assert.ok(afterRecoveryBytes <= 120 * 1_024);
    console.log('recovery-headroom-evidence', { beforeRecoveryBytes, afterRecoveryBytes, retainedGrants: tenant.grants.length });
  } finally { await h.mf.dispose(); }
});

test('native total-two slot limit preserves recovery headroom before ordinary API saturation', async () => {
  const h = await warmHarness();
  try {
    await h.db.prepare('UPDATE budget_owner_policies SET max_reservations=2').run();
    const first = await h.create('slot-headroom-first'); assert.equal(first.status, 201);
    const ticket = await first.json() as { id: string };
    const rejected = await h.mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${ticket.id}/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify({ body: 'must not consume recovery slot' }),
    });
    assert.equal(rejected.status, 429); await rejected.body?.cancel();
    assert.equal((await h.db.prepare("SELECT count(*) AS n FROM articles WHERE body='must not consume recovery slot'").first<{ n: number }>())!.n, 0);
    assert.equal((await h.grants()).filter(grant => !grant.compacted).length, 1);
    await h.control({ now: h.initialNow + 30_001 });
    const later = await h.create('slot-headroom-after-recovery'); assert.equal(later.status, 201); await later.body?.cancel();
    const tenant = (await h.coordinatorState()).tenantStates[0];
    assert.equal(tenant.closedCharges.find(row => row.dimension === 'workerRequests' && row.purpose === 'new-work')?.units, 2);
    assert.equal(tenant.closedCharges.find(row => row.dimension === 'workerRequests' && row.purpose === 'recovery')?.units, 2);
    assert.ok(tenant.grants.filter(grant => !grant.compacted).length <= 2);
    assert.equal((await h.control()).calls.reconcile, 1);
  } finally { await h.mf.dispose(); }
});

test('native total-one slot configuration rejects ordinary work without borrowing recovery capacity', async () => {
  const h = await warmHarness();
  try {
    await h.db.prepare('UPDATE budget_owner_policies SET max_reservations=1').run();
    const rejected = await h.create('one-slot-cannot-intake'); assert.equal(rejected.status, 429); await rejected.body?.cancel();
    assert.equal(await h.count(), 0); assert.equal((await h.grants()).length, 0);
  } finally { await h.mf.dispose(); }
});
