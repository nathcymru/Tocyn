import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('real Miniflare canonical ticket events and typing are session, tenant and current-ticket authorized', async () => {
  const bundle = await build({ entryPoints: ['scripts/notification-collaboration-runtime-entry.ts'], bundle: true,
    format: 'esm', platform: 'neutral', write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'notification-collaboration', modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2024-04-03',
    durableObjects: { NOTIFICATION_DO: 'NotificationCollaborationFixture' }, d1Databases: ['DB'],
    unsafeEphemeralDurableObjects: true }] }));
  const clients: any[] = [];
  try {
    const db = await mf.getD1Database('DB');
    await db.exec('CREATE TABLE users (tenant_id TEXT, id TEXT, role TEXT, password_hash TEXT, session_version INTEGER, mfa_enabled INTEGER, email TEXT, full_name TEXT, PRIMARY KEY (tenant_id,id))');
    await db.exec('CREATE TABLE tickets (tenant_id TEXT, id TEXT, group_id TEXT, PRIMARY KEY (tenant_id,id))');
    await db.exec('CREATE TABLE user_groups (tenant_id TEXT, user_id TEXT, group_id TEXT, PRIMARY KEY (tenant_id,user_id,group_id))');
    await db.exec("INSERT INTO users VALUES ('A','alice','agent',NULL,0,1,'alice@example.test','Alice Current'), ('A','bob','agent',NULL,0,1,'bob@example.test','Bob Current'), ('A','outsider','agent',NULL,0,1,'outsider@example.test','Outsider'), ('A','customer','customer',NULL,0,1,'customer@example.test','Customer'), ('B','bob','agent',NULL,0,1,'bob-b@example.test','Bob Tenant B')");
    await db.exec("INSERT INTO tickets VALUES ('A','ticket-1','support'), ('B','ticket-1','support')");
    await db.exec("INSERT INTO user_groups VALUES ('A','alice','support'), ('A','bob','support'), ('B','bob','support')");
    const namespace: any = await mf.getDurableObjectNamespace('NOTIFICATION_DO');
    const connect = async (tenantId: string, userId: string) => {
      const response = await namespace.get(namespace.idFromName(`tenant:${tenantId}`)).fetch('http://do/connect', { headers: {
        Upgrade: 'websocket', 'X-Tenant-ID': tenantId, 'X-User-ID': userId, 'X-User-Name': 'Untrusted header',
        'X-Session-Role': userId === 'customer' ? 'customer' : 'agent', 'X-Session-Version': '0',
        'X-Session-Expiry': String(Math.floor(Date.now() / 1000) + 120),
      } });
      return response;
    };
    assert.equal((await connect('A', 'customer')).status, 401);
    const track = (response: any) => {
      assert.equal(response.status, 101); const client = response.webSocket; client.accept(); clients.push(client);
      const messages: any[] = []; client.addEventListener('message', (event: any) => messages.push(JSON.parse(String(event.data))));
      return { client, messages };
    };
    const alice = track(await connect('A', 'alice'));
    const bob = track(await connect('A', 'bob'));
    const outsider = track(await connect('A', 'outsider'));
    const tenantB = track(await connect('B', 'bob'));
    const canonical = async (type: string, payload: unknown) => {
      const response = await namespace.get(namespace.idFromName('tenant:A')).fetch('http://do/broadcast', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, payload }),
      });
      assert.equal(response.status, 200); await response.body?.cancel();
    };
    await canonical('ticket.created', { id: 'ticket-1', subject: 'Restricted' });
    await canonical('ticket.updated', { id: 'ticket-1', status: 'pending' });
    await canonical('article.created', { ticket_id: 'ticket-1', article_id: 'article-1' });
    await until(() => bob.messages.filter(event => ['ticket.created','ticket.updated','article.created'].includes(event.type)).length === 3);
    assert.equal(outsider.messages.some(event => ['ticket.created','ticket.updated','article.created'].includes(event.type)), false);
    const malformed = await namespace.get(namespace.idFromName('tenant:A')).fetch('http://do/broadcast', {
      method: 'POST', body: JSON.stringify({ type: 'article.created', payload: { article_id: 'missing-ticket' } }),
    });
    assert.equal(malformed.status, 400, 'ticket-bearing canonical events without a bounded ticket id fail closed');
    const before = Date.now();
    alice.client.send(JSON.stringify({ type: 'collaboration.typing.v1', payload: {
      version: 1, ticketId: 'ticket-1', baseConversationRevision: 3, active: true,
      actor: { id: 'spoofed', name: 'Spoofed' }, expiresAt: Date.now() + 60_000,
    } }));
    await until(() => bob.messages.filter(event => event.type === 'collaboration.typing.v1').length === 1);
    const signal = bob.messages.find(event => event.type === 'collaboration.typing.v1');
    assert.deepEqual(signal.payload.actor, { id: 'alice', name: 'Alice Current' });
    assert.equal(signal.payload.ticketId, 'ticket-1'); assert.equal(signal.payload.baseConversationRevision, undefined);
    assert.ok(signal.payload.expiresAt - before >= 5000 && signal.payload.expiresAt - before <= 7000);
    assert.equal(outsider.messages.some(event => event.type === 'collaboration.typing.v1'), false);
    assert.equal(tenantB.messages.some(event => event.type === 'collaboration.typing.v1'), false);

    // Protocol failures and one-second duplicate bursts are silent advisory drops.
    alice.client.send(JSON.stringify({ type: 'collaboration.typing.v1', payload: { version: 2, ticketId: 'ticket-1', baseConversationRevision: 3, active: true } }));
    alice.client.send(JSON.stringify({ type: 'collaboration.typing.v1', payload: { version: 1, ticketId: 'ticket-1', baseConversationRevision: 3, active: false } }));
    await pause(30); assert.equal(bob.messages.filter(event => event.type === 'collaboration.typing.v1').length, 1);

    // Membership is checked again for every recipient; a revocation prevents the next event without a replay.
    await db.prepare("DELETE FROM user_groups WHERE tenant_id='A' AND user_id='bob' AND group_id='support'").run();
    await canonical('article.created', { ticket_id: 'ticket-1', article_id: 'after-revocation' });
    await pause(30); assert.equal(bob.messages.filter(event => event.type === 'article.created').length, 1);
    await pause(1000);
    alice.client.send(JSON.stringify({ type: 'collaboration.typing.v1', payload: { version: 1, ticketId: 'ticket-1', baseConversationRevision: 3, active: false } }));
    await pause(30); assert.equal(bob.messages.filter(event => event.type === 'collaboration.typing.v1').length, 1);

    // The sender is checked against that same current group boundary.
    await db.prepare("DELETE FROM user_groups WHERE tenant_id='A' AND user_id='alice' AND group_id='support'").run();
    await pause(1000);
    alice.client.send(JSON.stringify({ type: 'collaboration.typing.v1', payload: { version: 1, ticketId: 'ticket-1', baseConversationRevision: 3, active: true } }));
    await pause(30); assert.equal(bob.messages.filter(event => event.type === 'collaboration.typing.v1').length, 1);

    // A new connection has no retained typing state and cannot replay the closed connection's hint.
    alice.client.close(1000, 'reconnect');
    await pause(30);
    await db.prepare("INSERT INTO user_groups VALUES ('A','alice','support'), ('A','bob','support')").run();
    const aliceReconnected = track(await connect('A', 'alice'));
    aliceReconnected.client.send(JSON.stringify({ type: 'collaboration.typing.v1', payload: { version: 1, ticketId: 'ticket-1', baseConversationRevision: 3, active: true } }));
    await until(() => bob.messages.filter(event => event.type === 'collaboration.typing.v1').length === 2);
  } finally {
    for (const client of clients) try { client.close(); } catch { /* Native close may already have completed. */ }
    await mf.dispose();
  }
});

function pause(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for native websocket delivery');
    await pause(10);
  }
}
