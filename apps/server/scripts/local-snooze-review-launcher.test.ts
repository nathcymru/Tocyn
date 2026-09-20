import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import * as OTPAuth from 'otpauth';
import { createReviewDisposal, startIsolatedSnoozeReview } from './local-snooze-review-launcher';

async function sparePort(): Promise<number> {
  for (;;) {
    const server = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') reject(new Error('Expected loopback TCP port'));
        else resolve(address.port);
      });
    });
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (port !== 8787) return port;
  }
}

test('launcher rejects the existing review port and unbounded authority windows before setup', async () => {
  await assert.rejects(startIsolatedSnoozeReview({ port: 8787, intervalWindowMs: 60_000 }));
  await assert.rejects(startIsolatedSnoozeReview({ port: 8790, intervalWindowMs: 86_400_001 }));
});

test('a throwing RPC disposer does not skip runtime and file cleanup and remains retryable', async () => {
  const calls: string[] = [];
  const failure = new Error('synthetic RPC disposal failure');
  let failRpc = true;
  const dispose = createReviewDisposal({
    controller: async () => { calls.push('controller'); },
    rpc: () => { calls.push('rpc'); if (failRpc) throw failure; },
    runtime: async () => { calls.push('runtime'); },
    files: async () => { calls.push('files'); },
  });
  await assert.rejects(dispose(), error => error === failure);
  assert.deepEqual(calls, ['controller', 'rpc', 'runtime', 'files']);
  failRpc = false;
  await dispose();
  await dispose();
  assert.deepEqual(calls, ['controller', 'rpc', 'runtime', 'files', 'rpc']);
});

test('isolated one-owner review launcher serves authenticated app and wakes private due work without a route', async () => {
  const port = await sparePort();
  const scheduler = { set(callback: () => void, requestedMs: number) {
    assert.equal(requestedMs, 60_000);
    return setTimeout(callback, 80);
  }, clear(handle: unknown) { clearTimeout(handle as NodeJS.Timeout); } };
  const review = await startIsolatedSnoozeReview({ port, intervalWindowMs: 60_000, scheduler });
  try {
    const health = await fetch(`${review.origin}/health`);
    assert.equal(health.status, 200);
    await health.body?.cancel();
    const privateRoute = await fetch(`${review.origin}/runDue`);
    assert.ok([404, 503].includes(privateRoute.status), 'private due RPC has no successful HTTP route');
    await privateRoute.body?.cancel();
    assert.equal((await review.db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='fixture-tenant-a'")
      .first<{ n: number }>())?.n, 0, 'the denied HTTP request cannot run due work');

    const operator = review.credentials.find(credential => credential.email === 'fixture.operator.a@example.test');
    assert.ok(operator?.provisioningUri);
    const login = await fetch(`${review.origin}/api/auth/login`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: operator.email, password: operator.password }) });
    assert.equal(login.status, 200);
    const challenge = await login.json() as { token: string; mfa_required: boolean };
    assert.equal(challenge.mfa_required, true);
    const code = OTPAuth.URI.parse(operator.provisioningUri);
    assert.ok(code instanceof OTPAuth.TOTP);
    const verified = await fetch(`${review.origin}/api/auth/mfa/verify`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${challenge.token}` },
      body: JSON.stringify({ code: code.generate() }) });
    assert.equal(verified.status, 200);
    await verified.body?.cancel();

    // Change only this disposable run's deadline after its first due cycle.
    await review.db.prepare("UPDATE ticket_support_state SET snoozed_until=? WHERE tenant_id='fixture-tenant-a' AND ticket_id='due-review'")
      .bind(new Date(Date.now() + 300).toISOString()).run();
    const deadline = Date.now() + 5_000;
    let events = 0;
    while (Date.now() < deadline) {
      events = (await review.db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='fixture-tenant-a' AND ticket_id='due-review' AND kind='ticket.transition'")
        .first<{ n: number }>())?.n ?? 0;
      if (events === 1) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(events, 1, 'host timer must invoke private due RPC without a test tick');
    assert.deepEqual(await review.db.prepare("SELECT snoozed_until,resurface_reason FROM ticket_support_state WHERE tenant_id='fixture-tenant-a' AND ticket_id='due-review'").first(),
      { snoozed_until: null, resurface_reason: 'due' });
    assert.equal((await review.db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='fixture-tenant-b' AND ticket_id='due-review' AND kind='ticket.transition'")
      .first<{ n: number }>())?.n, 0, 'same ticket ID in tenant B remains isolated');
    assert.ok((await review.db.prepare("SELECT snoozed_until FROM ticket_support_state WHERE tenant_id='fixture-tenant-b' AND ticket_id='due-review'")
      .first<{ snoozed_until: string | null }>())?.snoozed_until);
  } finally {
    await review.dispose();
  }
});
