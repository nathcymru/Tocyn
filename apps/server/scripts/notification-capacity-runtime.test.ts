import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { MAX_NOTIFICATION_CONNECTIONS, MAX_NOTIFICATION_BROADCAST_ATTEMPTS } from '../src/durable_objects/notification-limits';

test('real hibernating WebSockets enforce capacity, concurrent admission, complete fanout and bounded live reads', async () => {
  const bundle = await build({ entryPoints: ['scripts/notification-capacity-runtime-entry.ts'], bundle: true,
    format: 'esm', platform: 'neutral', write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'notification-capacity', modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2024-04-03',
    durableObjects: { NOTIFICATION_DO: 'NotificationCapacityFixture' }, d1Databases: ['DB'],
    unsafeEphemeralDurableObjects: true }] }));
  const clients: any[] = [];
  try {
    const db = await mf.getD1Database('DB');
    await db.exec(`CREATE TABLE users (tenant_id TEXT, id TEXT, role TEXT, password_hash TEXT, session_version INTEGER, mfa_enabled INTEGER, email TEXT, full_name TEXT, PRIMARY KEY (tenant_id,id));
      INSERT INTO users VALUES ('A','staff','agent',NULL,0,1,'staff-a@example.test','Staff A');
      INSERT INTO users VALUES ('B','staff','agent',NULL,0,1,'staff-b@example.test','Staff B');`);
    const namespace: any = await mf.getDurableObjectNamespace('NOTIFICATION_DO');
    const stub = namespace.get(namespace.idFromName('tenant:A'));
    const headers = { Upgrade: 'websocket', 'X-Tenant-ID': 'A', 'X-User-ID': 'staff', 'X-User-Name': 'Staff',
      'X-Session-Role': 'agent', 'X-Session-Version': '0', 'X-Session-Expiry': String(Math.floor(Date.now() / 1000) + 600) };
    const messages: Array<{ client: any; data: any }> = [];
    const track = (response: any) => {
      if (!response.webSocket) return;
      const client = response.webSocket; client.accept(); clients.push(client);
      client.addEventListener('message', (event: any) => { messages.push({ client, data: JSON.parse(String(event.data)) }); });
      client.addEventListener('close', () => { try { client.close(); } catch { /* Closed. */ } });
    };
    const counts = async () => await (await stub.fetch('http://do/fixture-counts')).json() as any;
    const reset = () => stub.fetch('http://do/fixture-reset');
    // Bulk seed is only setup: no claim that these are authenticated HTTP upgrades.
    for (let i = 0; i < MAX_NOTIFICATION_CONNECTIONS - 1; i++) track(await stub.fetch('http://do/fixture-seed', { headers }));
    const boundary = await Promise.all(Array.from({ length: 3 }, () => stub.fetch('http://do/connect', { headers })));
    assert.deepEqual(boundary.map((response: any) => response.status).sort(), [101, 503, 503]);
    for (const response of boundary) track(response);
    assert.equal((await counts()).registered, MAX_NOTIFICATION_CONNECTIONS);
    const wrongTenant = await stub.fetch('http://do/connect', { headers: { ...headers, 'X-Tenant-ID': 'B' } });
    assert.equal(wrongTenant.status, 401);
    assert.equal((await counts()).registered, MAX_NOTIFICATION_CONNECTIONS);

    await reset();
    for (let attempt = 0; attempt < MAX_NOTIFICATION_BROADCAST_ATTEMPTS; attempt++) {
      assert.equal((await stub.fetch('http://do/broadcast', { method: 'POST', body: JSON.stringify({ type: 'capacity.proof', attempt }) })).status, 200);
    }
    await until(() => messages.filter(event => event.data.type === 'capacity.proof').length === 3 * MAX_NOTIFICATION_CONNECTIONS);
    const measured = await counts();
    assert.equal(measured.queries, 3 * MAX_NOTIFICATION_CONNECTIONS);
    assert.equal(measured.rowsRead, 3 * MAX_NOTIFICATION_CONNECTIONS);
    assert.equal(measured.sends, 3 * MAX_NOTIFICATION_CONNECTIONS);
    for (const client of clients) assert.equal(messages.filter(event => event.client === client && event.data.type === 'capacity.proof').length, 3);

    // Native close handshake releases a registered slot; the next authenticated connection recovers it.
    clients[0].close(1000, 'fixture complete');
    await until(async () => (await counts()).registered === MAX_NOTIFICATION_CONNECTIONS - 1);
    const recovered = await stub.fetch('http://do/connect', { headers }); assert.equal(recovered.status, 101); track(recovered);
    await db.prepare("UPDATE users SET session_version = 1 WHERE tenant_id = 'A'").run();
    const beforeRevocation = messages.length;
    await reset();
    assert.equal((await stub.fetch('http://do/broadcast', { method: 'POST', body: '{"type":"revoked.secret"}' })).status, 200);
    await until(async () => (await counts()).registered === 0);
    assert.ok((await counts()).queries <= MAX_NOTIFICATION_CONNECTIONS + 2 * MAX_NOTIFICATION_CONNECTIONS ** 2);
    assert.equal(messages.slice(beforeRevocation).some(event => event.data.type === 'revoked.secret'), false);
    assert.equal((await stub.fetch('http://do/connect', { headers })).status, 401);
    const restored = await stub.fetch('http://do/connect', { headers: { ...headers, 'X-Session-Version': '1' } });
    assert.equal(restored.status, 101); track(restored);

    // A registry from an older implementation is rejected whole; reconstruction is also covered by the focused test.
    const legacy = namespace.get(namespace.idFromName('tenant:B'));
    for (let i = 0; i < MAX_NOTIFICATION_CONNECTIONS + 1; i++) track(await legacy.fetch('http://do/fixture-seed', { headers: { ...headers, 'X-Tenant-ID': 'B' } }));
    assert.equal((await legacy.fetch('http://do/broadcast', { method: 'POST', body: '{"type":"legacy.secret"}' })).status, 503);
    const legacyCounts = await (await legacy.fetch('http://do/fixture-counts')).json() as any;
    assert.equal(legacyCounts.queries, 0); assert.equal(legacyCounts.sends, 0);
  } finally {
    for (const client of clients) try { client.close(); } catch { /* Already closed. */ }
    await mf.dispose();
  }
});

async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for native WebSocket lifecycle');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
