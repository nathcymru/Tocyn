import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { SignJWT } from 'jose';
import { CANONICAL_BROADCAST_ENVELOPE, MAX_REALTIME_EVENTS_PER_LEASE, MAX_REALTIME_LEASE_RECEIPTS, MAX_REALTIME_PRESENCE_EVENTS_PER_LEASE, MAX_REALTIME_TYPING_EVENTS_PER_LEASE, realtimeConnectionEnvelope, realtimeReceiptIndexBytes, realtimeReceiptKey, signCanonicalBroadcastHandoff, signRealtimeLease, verifyCanonicalBroadcastHandoff, verifyRealtimeLease, type CanonicalBroadcastGrant, type RealtimeLeaseClaim } from '../src/budgets/realtime-admission.service';
import { splitSql } from './split-sql';

const secret = 'synthetic-realtime-lease-secret-at-least-32-characters';
const serverRoot = resolve(import.meta.dirname, '..');

async function applyMigrations(db: D1Database): Promise<void> {
  const directory = join(serverRoot, 'migrations');
  for (const file of readdirSync(directory).filter(file => file.endsWith('.sql')).sort()) {
    await db.batch(splitSql(readFileSync(join(directory, file), 'utf8')).map(statement => db.prepare(statement)));
  }
}

function realtimePolicy(limits: Partial<Record<string, number>> = {}) {
  const dimensions = ['workerRequests', 'd1RowsRead', 'd1RowsWritten', 'r2ClassBOperations',
    'doRequests', 'doRowsRead', 'doRowsWritten', 'logEvents'];
  const ceiling = Object.fromEntries(dimensions.map(dimension => [dimension, 20_000_000_000]));
  Object.assign(ceiling, limits);
  return {
    schemaVersion: 1, policyId: 'realtime-worker-policy', revision: 1, deploymentId: 'realtime-worker-deployment',
    mode: 'conservative', catalogueVersion: 'synthetic-runtime', maxGrantLifetimeMs: 60_000,
    budgets: dimensions.map(dimension => ({ dimension, allocationId: `realtime-${dimension}`,
      window: { kind: 'interval', id: 'realtime-window', startsAt: Date.now() - 1_000, endsAt: Date.now() + 60_000 },
      limit: ceiling[dimension], recoveryPercent: 20, provenance: 'owner-allocation' as const })),
  };
}

async function seedWorkerAdmission(db: D1Database, owner = realtimePolicy()): Promise<void> {
  const tenantId = 'realtime-worker-tenant';
  const restriction = { schemaVersion: 1, tenantId, ownerPolicyId: owner.policyId, ownerPolicyRevision: 1,
    revision: 1, mode: 'conservative', limits: Object.fromEntries(owner.budgets.map(item => [item.dimension, item.limit])), disabledFeatures: [] };
  await db.batch([
    db.prepare(`INSERT INTO budget_deployment_authority (deployment_id,authority_revision,state,updated_at)
      VALUES ('realtime-worker-deployment',1,'active',?)`).bind(Date.now()),
    db.prepare(`INSERT INTO budget_owner_policies
      (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES ('realtime-worker-deployment','realtime-worker-policy',1,1,'realtime-worker-coordinator',64,60000,?)`).bind(JSON.stringify(owner)),
    db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES ('realtime-worker-deployment',?,'realtime-worker-policy',1,1,'realtime-worker-namespace',?,'active')`).bind(tenantId, JSON.stringify(restriction)),
    db.prepare(`INSERT INTO users (tenant_id,id,email,full_name,role,session_version,mfa_enabled)
      VALUES (?,'realtime-worker-agent','agent@realtime.test','Realtime Agent','agent',1,1)`).bind(tenantId),
  ]);
}

async function realtimeWorkerToken(): Promise<string> {
  return new SignJWT({ sub: 'realtime-worker-agent', role: 'agent', tenant_id: 'realtime-worker-tenant', session_version: 1, mfa_verified: true })
    .setProtectedHeader({ alg: 'HS256' }).setAudience('app').setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

function headers(claim: RealtimeLeaseClaim, signature: string) {
  return { Upgrade: 'websocket', 'X-Tenant-ID': claim.tenantId, 'X-User-ID': claim.actorId, 'X-User-Name': `${claim.actorId} current`,
    'X-Session-Role': claim.role, 'X-Session-Version': String(claim.sessionVersion), 'X-Session-Expiry': String(Math.floor((claim.expiresAt + 60_000) / 1_000)),
    'X-Realtime-Lease': JSON.stringify(claim), 'X-Realtime-Lease-Signature': signature };
}

async function lease(tenantId: string, actorId: string, now: number, suffix: string): Promise<{ claim: RealtimeLeaseClaim; signature: string }> {
  const claim: RealtimeLeaseClaim = { version: 1, leaseId: `lease-${suffix}`, tenantId, actorId, role: 'agent', sessionVersion: 0,
    expiresAt: now + 30_000, authorityExpiresAt: now + 30_000, authorityRevision: 1, policyId: 'fixture-policy', policyRevision: 1,
    restrictionRevision: 1, frames: MAX_REALTIME_EVENTS_PER_LEASE, typingEvents: MAX_REALTIME_TYPING_EVENTS_PER_LEASE,
    presenceEvents: MAX_REALTIME_PRESENCE_EVENTS_PER_LEASE, alarms: 1, cleanups: 1 };
  const signed = await signRealtimeLease(secret, claim);
  assert.ok(signed, 'fixture lease must be signable');
  return { claim, signature: signed.signature };
}

test('real D1/DO realtime leases reject forged forwarding, isolate tenants, cap warm frames and fail closed after reconstruction/revocation', async () => {
  const reserved = realtimeConnectionEnvelope();
  assert.ok((reserved.d1RowsRead ?? 0) > 30_000, 'the lifecycle envelope contains every finite callback before admission');
  const nowForBounds = Date.now();
  await assert.doesNotReject(async () => {
    assert.equal(await verifyRealtimeLease(secret, JSON.stringify({ leaseId: null }), '0'.repeat(64), nowForBounds), null);
    assert.equal(await verifyCanonicalBroadcastHandoff(secret, JSON.stringify({ grant: null, signature: '0'.repeat(64), payloadDigest: '0'.repeat(64) }), '0'.repeat(64), '{}', nowForBounds), null);
  }, 'decoded malformed claim and handoff shapes fail closed without escaping verification');
  const maxLeaseKey = await realtimeReceiptKey('lease', 'l'.repeat(160));
  const maxBroadcastKey = await realtimeReceiptKey('broadcast', 'h'.repeat(160), 'd'.repeat(64));
  assert.ok(maxLeaseKey && maxBroadcastKey);
  const maxLeaseReceipts = Array.from({ length: MAX_REALTIME_LEASE_RECEIPTS }, () => [maxLeaseKey, Number.MAX_SAFE_INTEGER]);
  const maxBroadcastReceipts = Array.from({ length: MAX_REALTIME_LEASE_RECEIPTS }, () => [maxBroadcastKey, Number.MAX_SAFE_INTEGER, 3]);
  assert.notEqual(realtimeReceiptIndexBytes(maxLeaseReceipts), null, '1,024 maximum-length lease IDs are fixed-width before durable storage');
  assert.notEqual(realtimeReceiptIndexBytes(maxBroadcastReceipts), null, '1,024 maximum-length handoff IDs remain within the explicit receipt value ceiling');
  const bundle = await build({ entryPoints: ['scripts/realtime-admission-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral',
    external: ['cloudflare:workers', 'node:crypto'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'realtime-admission-proof', modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2024-04-03', durableObjects: { NOTIFICATION_DO: 'RealtimeAdmissionFixture' },
    compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], bindings: { REALTIME_BUDGET_ADMISSION_POLICY: 'realtime-v1', JWT_SECRET: secret }, unsafeEphemeralDurableObjects: true }] }));
  const clients: any[] = [];
  try {
    const now = Date.now();
    const db = await mf.getD1Database('DB');
    await db.exec(`CREATE TABLE users (tenant_id TEXT, id TEXT, role TEXT, password_hash TEXT, session_version INTEGER, mfa_enabled INTEGER, email TEXT, full_name TEXT, PRIMARY KEY (tenant_id,id));
      INSERT INTO users VALUES ('A','alice','agent',NULL,0,1,'alice@example.test','Alice'), ('A','bob','agent',NULL,0,1,'bob@example.test','Bob'), ('A','carol','agent',NULL,0,1,'carol@example.test','Carol'), ('B','alice','agent',NULL,0,1,'alice-b@example.test','Alice B');`);
    const namespace: any = await mf.getDurableObjectNamespace('NOTIFICATION_DO');
    const [aliceA, bobA, aliceB] = await Promise.all([lease('A', 'alice', now, 'a'), lease('A', 'bob', now, 'b'), lease('B', 'alice', now, 'b-tenant')]);
    const objectA = namespace.get(namespace.idFromName('tenant:A'));
    const objectB = namespace.get(namespace.idFromName('tenant:B'));
    const forged = await objectA.fetch('http://do/connect', { headers: { ...headers(aliceA.claim, aliceA.signature), 'X-Realtime-Lease-Signature': '0'.repeat(64) } });
    assert.equal(forged.status, 401);
    const concurrentClaim = await lease('A', 'carol', now, 'same-claim');
    const concurrentConnections = await Promise.all([objectA.fetch('http://do/connect', { headers: headers(concurrentClaim.claim, concurrentClaim.signature) }),
      objectA.fetch('http://do/connect', { headers: headers(concurrentClaim.claim, concurrentClaim.signature) })]);
    assert.deepEqual(concurrentConnections.map(response => response.status).sort(), [101, 401], 'the input-gated lease ledger admits one same-claim upgrade');
    const concurrentWinner = concurrentConnections.find(response => response.status === 101)!;
    concurrentWinner.webSocket.accept(); clients.push(concurrentWinner.webSocket);
    const connect = async (object: any, signed: { claim: RealtimeLeaseClaim; signature: string }) => {
      const response = await object.fetch('http://do/connect', { headers: headers(signed.claim, signed.signature) });
      assert.equal(response.status, 101); response.webSocket.accept(); clients.push(response.webSocket);
      const messages: any[] = []; response.webSocket.addEventListener('message', (event: any) => messages.push(JSON.parse(String(event.data))));
      let closed: number | undefined;
      response.webSocket.addEventListener('close', (event: any) => { closed = event.code; });
      return { client: response.webSocket, messages, closeCode: () => closed };
    };
    const [a, b, otherTenant] = await Promise.all([connect(objectA, aliceA), connect(objectA, bobA), connect(objectB, aliceB)]);
    a.client.send(JSON.stringify({ type: 'presence.update', payload: { location: 'A-only' } }));
    await until(() => b.messages.some(message => message.type === 'presence.update' && message.payload.location === 'A-only'));
    assert.equal(otherTenant.messages.some(message => message.type === 'presence.update' && message.payload.location === 'A-only'), false);
    for (let event = 0; event < MAX_REALTIME_EVENTS_PER_LEASE; event++) a.client.send(JSON.stringify({ type: 'unknown', event }));
    await pause(40);
    a.client.send(JSON.stringify({ type: 'unknown', event: 'exhaust' }));
    await until(() => a.closeCode() === 1013);
    assert.equal((await (await objectA.fetch('http://do/fixture-lease-count')).json() as { leases: number }).leases, 2, 'close cleanup releases its durable lease without a replacement');
    assert.equal((await objectA.fetch('http://do/connect', { headers: headers(aliceA.claim, aliceA.signature) })).status, 401,
      'a closed but still-current lease receipt cannot be replayed into the freed socket slot');
    const replacement = await lease('A', 'alice', now, 'a-replacement');
    const replacementClient = await connect(objectA, replacement);
    assert.equal(replacementClient.closeCode(), undefined, 'a distinct current lease reuses a released socket even while closed receipts are retained');

    // The persisted attachment/ledger survives a new object instance, and a
    // current session-version loss closes before another advisory delivery.
    await db.prepare("UPDATE users SET session_version=1 WHERE tenant_id='A' AND id='bob'").run();
    await objectA.fetch('http://do/fixture-reconstruct');
    await until(() => b.closeCode() === 1008);
    assert.equal(otherTenant.closeCode(), undefined);

    // A burst of historical receipts cannot consume the 128 live socket slots;
    // the bounded 1,024 index fails closed only at its stated ceiling and
    // automatically releases expired entries before a replacement connection.
    await objectA.fetch('http://do/fixture-receipt-burst', { method: 'POST', body: JSON.stringify({ count: 128, expiresAt: now + 30_000 }) });
    const burstLease = await lease('A', 'alice', now, 'a-burst');
    const burstClient = await connect(objectA, burstLease);
    assert.equal(burstClient.closeCode(), undefined);
    await burstClient.client.close();
    await objectA.fetch('http://do/fixture-receipt-burst', { method: 'POST', body: JSON.stringify({ count: 1_024, expiresAt: now + 30_000 }) });
    const exhaustedLease = await lease('A', 'alice', now, 'a-receipts-exhausted');
    assert.equal((await objectA.fetch('http://do/connect', { headers: headers(exhaustedLease.claim, exhaustedLease.signature) })).status, 401);
    await objectA.fetch('http://do/fixture-clock', { method: 'POST', body: JSON.stringify({ now: now + 30_001 }) });
    const recoveredLease = await lease('A', 'alice', now + 30_001, 'a-receipts-recovered');
    const recoveredClient = await connect(objectA, recoveredLease);
    assert.equal(recoveredClient.closeCode(), undefined, 'expired receipt capacity recovers without a restart');

    const body = JSON.stringify({ type: 'ticket.updated', payload: { id: 'ticket-A' } });
    const canonicalGrant: CanonicalBroadcastGrant = { version: 1, handoffId: 'canonical-fixture-handoff', tenantId: 'A', operationId: 'operation-fixture', operationFingerprint: 'f'.repeat(64),
      reservationId: 'reservation-fixture', holderId: 'holder-fixture', aggregateId: 'aggregate-fixture', expiresAt: now + 60_000,
      authorityRevision: 1, policyId: 'fixture-policy', policyRevision: 1, restrictionRevision: 1,
      notificationEnvelope: CANONICAL_BROADCAST_ENVELOPE, operationEnvelope: CANONICAL_BROADCAST_ENVELOPE };
    const handoff = await signCanonicalBroadcastHandoff(secret, canonicalGrant, body, now + 30_001);
    assert.ok(handoff);
    const canonicalHeaders = { 'Content-Type': 'application/json', 'X-Realtime-Canonical-Handoff': JSON.stringify(handoff), 'X-Realtime-Canonical-Handoff-Signature': handoff.signature };
    assert.equal((await objectA.fetch('http://do/broadcast', { method: 'POST', body })).status, 503, 'client-shaped canonical events have no prepaid authority');
    const concurrentBroadcasts = await Promise.all([objectA.fetch('http://do/broadcast', { method: 'POST', body, headers: canonicalHeaders }),
      objectA.fetch('http://do/broadcast', { method: 'POST', body, headers: canonicalHeaders })]);
    assert.deepEqual(concurrentBroadcasts.map(response => response.status).sort(), [200, 200], 'the input-gated handoff ledger retains both bounded lost-ack retries');
    assert.equal((await objectA.fetch('http://do/broadcast', { method: 'POST', body, headers: canonicalHeaders })).status, 200);
    assert.equal((await objectA.fetch('http://do/broadcast', { method: 'POST', body, headers: canonicalHeaders })).status, 503, 'lost-ack retries are bounded to the existing three attempts');
    assert.equal((await objectA.fetch('http://do/broadcast', { method: 'POST', body: JSON.stringify({ type: 'ticket.updated', payload: { id: 'tampered' } }), headers: canonicalHeaders })).status, 503,
      'the signature is bound to the immutable notification body');

    // The lease is clipped to authority freshness, so a policy/restriction
    // successor cannot continue delivery after that checked interval.
    await objectB.fetch('http://do/fixture-clock', { method: 'POST', body: JSON.stringify({ now: now + 60_000 }) });
    await objectB.fetch('http://do/fixture-reconstruct');
    await until(() => otherTenant.closeCode() === 1013);
  } finally {
    for (const client of clients) try { client.close(); } catch { /* Already closed. */ }
    await mf.dispose();
  }
});

test('configured Worker realtime admission reaches the coordinator before upgrade and rejects exhausted or revoked authority before NotificationDO accepts', async () => {
  const bundle = await build({ entryPoints: [resolve(import.meta.dirname, 'realtime-admission-runtime-entry.ts')], bundle: true,
    format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  const start = async (name: string, owner = realtimePolicy()) => {
    const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name, modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'],
      bindings: { REALTIME_BUDGET_ADMISSION_POLICY: 'realtime-v1', JWT_SECRET: secret, DISABLE_RATE_LIMIT: 'true', ENVIRONMENT: 'local' },
      d1Databases: { DB: `${name}-d1` },
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO', NOTIFICATION_DO: 'RealtimeAdmissionFixture' },
      unsafeEphemeralDurableObjects: true,
    }] }));
    const db = await mf.getD1Database('DB');
    await applyMigrations(db);
    await seedWorkerAdmission(db, owner);
    return { mf, db };
  };
  const token = await realtimeWorkerToken();
  const upgrade = (mf: Miniflare) => mf.dispatchFetch(`http://runtime.test/api/realtime?token=${encodeURIComponent(token)}`, {
    headers: { Upgrade: 'websocket' },
  });
  const fetchCount = async (mf: Miniflare) => {
    const namespace: any = await mf.getDurableObjectNamespace('NOTIFICATION_DO');
    const object = namespace.get(namespace.idFromName('tenant:realtime-worker-tenant'));
    return (await (await object.fetch('http://do/fixture-fetch-count')).json() as { fetches: number }).fetches;
  };

  const admitted = await start('realtime-worker-admitted');
  let accepted: any;
  try {
    accepted = await upgrade(admitted.mf);
    if (accepted.status !== 101) throw new Error(`Worker realtime admission unexpectedly rejected: ${accepted.status} ${await accepted.text()}`);
    assert.equal(await fetchCount(admitted.mf), 1, 'the admitted upgrade reaches NotificationDO exactly once');
    accepted.webSocket?.accept();

    await admitted.db.prepare("UPDATE budget_tenant_allocations SET state='revoked' WHERE tenant_id='realtime-worker-tenant'").run();
    const revokedAuthority = await upgrade(admitted.mf);
    assert.equal(revokedAuthority.status, 503, 'a current authority revocation is unavailable before websocket acceptance');
    assert.equal(await fetchCount(admitted.mf), 1, 'revoked authority never forwards a request to NotificationDO');
    await revokedAuthority.body?.cancel();

    await admitted.db.prepare("UPDATE budget_tenant_allocations SET state='active' WHERE tenant_id='realtime-worker-tenant'").run();
    await admitted.db.prepare("UPDATE users SET session_version=2 WHERE tenant_id='realtime-worker-tenant' AND id='realtime-worker-agent'").run();
    const revokedSession = await upgrade(admitted.mf);
    assert.equal(revokedSession.status, 401, 'a current credential revocation is rejected before budget or websocket work');
    assert.equal(await fetchCount(admitted.mf), 1, 'revoked credentials never reach NotificationDO');
    await revokedSession.body?.cancel();
  } finally {
    try { accepted?.webSocket?.close(); } catch { /* Already closed. */ }
    await admitted.mf.dispose();
  }

  const exhausted = await start('realtime-worker-exhausted', realtimePolicy({ workerRequests: 1 }));
  try {
    const denied = await upgrade(exhausted.mf);
    assert.equal(denied.status, 429, 'a real owner/tenant ceiling rejects the pre-upgrade reservation');
    assert.deepEqual(await denied.json(), { code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' });
    assert.equal(await fetchCount(exhausted.mf), 0, 'an exhausted reservation cannot enter NotificationDO');
  } finally {
    await exhausted.mf.dispose();
  }
});

function pause(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  // The proof deliberately drains 510 serialized durable callbacks.  Parallel
  // Miniflare workers can make that finite queue exceed the normal UI wait.
  const deadline = Date.now() + 30_000;
  while (!await predicate()) { if (Date.now() >= deadline) throw new Error('Timed out waiting for native realtime lifecycle'); await pause(10); }
}
