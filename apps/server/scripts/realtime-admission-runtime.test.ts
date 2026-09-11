import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { CANONICAL_BROADCAST_ENVELOPE, MAX_REALTIME_EVENTS_PER_LEASE, MAX_REALTIME_PRESENCE_EVENTS_PER_LEASE, MAX_REALTIME_TYPING_EVENTS_PER_LEASE, realtimeConnectionEnvelope, signCanonicalBroadcastHandoff, signRealtimeLease, type CanonicalBroadcastGrant, type RealtimeLeaseClaim } from '../src/budgets/realtime-admission.service';

const secret = 'synthetic-realtime-lease-secret-at-least-32-characters';

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
  const bundle = await build({ entryPoints: ['scripts/realtime-admission-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'realtime-admission-proof', modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2024-04-03', durableObjects: { NOTIFICATION_DO: 'RealtimeAdmissionFixture' },
    d1Databases: ['DB'], bindings: { REALTIME_BUDGET_ADMISSION_POLICY: 'realtime-v1', JWT_SECRET: secret }, unsafeEphemeralDurableObjects: true }] }));
  const clients: any[] = [];
  try {
    const now = Date.now();
    const db = await mf.getD1Database('DB');
    await db.exec(`CREATE TABLE users (tenant_id TEXT, id TEXT, role TEXT, password_hash TEXT, session_version INTEGER, mfa_enabled INTEGER, email TEXT, full_name TEXT, PRIMARY KEY (tenant_id,id));
      INSERT INTO users VALUES ('A','alice','agent',NULL,0,1,'alice@example.test','Alice'), ('A','bob','agent',NULL,0,1,'bob@example.test','Bob'), ('B','alice','agent',NULL,0,1,'alice-b@example.test','Alice B');`);
    const namespace: any = await mf.getDurableObjectNamespace('NOTIFICATION_DO');
    const [aliceA, bobA, aliceB] = await Promise.all([lease('A', 'alice', now, 'a'), lease('A', 'bob', now, 'b'), lease('B', 'alice', now, 'b-tenant')]);
    const objectA = namespace.get(namespace.idFromName('tenant:A'));
    const objectB = namespace.get(namespace.idFromName('tenant:B'));
    const forged = await objectA.fetch('http://do/connect', { headers: { ...headers(aliceA.claim, aliceA.signature), 'X-Realtime-Lease-Signature': '0'.repeat(64) } });
    assert.equal(forged.status, 401);
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
    assert.equal((await (await objectA.fetch('http://do/fixture-lease-count')).json() as { leases: number }).leases, 1, 'close cleanup releases its durable lease without a replacement');
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
    assert.equal((await objectA.fetch('http://do/broadcast', { method: 'POST', body, headers: canonicalHeaders })).status, 200);
    assert.equal((await objectA.fetch('http://do/broadcast', { method: 'POST', body, headers: canonicalHeaders })).status, 200);
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

function pause(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  // The proof deliberately drains 510 serialized durable callbacks.  Parallel
  // Miniflare workers can make that finite queue exceed the normal UI wait.
  const deadline = Date.now() + 30_000;
  while (!await predicate()) { if (Date.now() >= deadline) throw new Error('Timed out waiting for native realtime lifecycle'); await pause(10); }
}
