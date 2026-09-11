import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { MAX_NOTIFICATION_CONNECTIONS } from '../src/durable_objects/notification-limits';

test('real Miniflare typing caps ticket/group authorization work across 128 authorized and denied synthetic sessions', async () => {
  const bundle = await build({ entryPoints: ['scripts/notification-typing-resource-runtime-entry.ts'], bundle: true,
    format: 'esm', platform: 'neutral', write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'notification-typing-resource', modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2024-04-03',
    durableObjects: { NOTIFICATION_DO: 'NotificationTypingResourceFixture' }, d1Databases: ['DB'],
    unsafeEphemeralDurableObjects: true }] }));
  const clients: any[] = [];
  try {
    const db = await mf.getD1Database('DB');
    await db.exec('CREATE TABLE users (tenant_id TEXT, id TEXT, role TEXT, password_hash TEXT, session_version INTEGER, mfa_enabled INTEGER, email TEXT, full_name TEXT, PRIMARY KEY (tenant_id,id))');
    await db.exec('CREATE TABLE tickets (tenant_id TEXT, id TEXT, group_id TEXT, PRIMARY KEY (tenant_id,id))');
    await db.exec('CREATE TABLE user_groups (tenant_id TEXT, user_id TEXT, group_id TEXT, PRIMARY KEY (tenant_id,user_id,group_id))');
    await db.exec("INSERT INTO users VALUES ('A','alice','agent',NULL,0,1,'alice@example.test','Alice'), ('A','allowed','agent',NULL,0,1,'allowed@example.test','Allowed'), ('A','denied','agent',NULL,0,1,'denied@example.test','Denied')");
    await db.exec("INSERT INTO tickets VALUES ('A','ticket-1','support')");
    await db.exec("INSERT INTO user_groups VALUES ('A','alice','support'), ('A','allowed','support')");
    const namespace: any = await mf.getDurableObjectNamespace('NOTIFICATION_DO');
    const stub = namespace.get(namespace.idFromName('tenant:A'));
    const seed = async (userId: string) => {
      const response: any = await stub.fetch('http://do/fixture-seed', { headers: { Upgrade: 'websocket', 'X-Tenant-ID': 'A', 'X-User-ID': userId } });
      assert.equal(response.status, 101); response.webSocket.accept(); clients.push(response.webSocket);
      const messages: any[] = []; response.webSocket.addEventListener('message', (event: any) => messages.push(JSON.parse(String(event.data))));
      return { client: response.webSocket, messages };
    };
    const sender = await seed('alice');
    const allowed = await Promise.all(Array.from({ length: 63 }, () => seed('allowed')));
    const denied = await Promise.all(Array.from({ length: 64 }, () => seed('denied')));
    assert.equal(clients.length, MAX_NOTIFICATION_CONNECTIONS);
    await stub.fetch('http://do/fixture-reset');
    sender.client.send(JSON.stringify({ type: 'collaboration.typing.v1', payload: {
      version: 1, ticketId: 'ticket-1', baseConversationRevision: 1, active: true,
    } }));
    await until(() => allowed.every(connection => connection.messages.filter(event => event.type === 'collaboration.typing.v1').length === 1));
    assert.equal(denied.some(connection => connection.messages.some(event => event.type === 'collaboration.typing.v1')), false);
    const counts = await (await stub.fetch('http://do/fixture-counts')).json() as { queries: number; rowsRead: number; registered: number };
    // Each participant invokes all three bounded checks. Denied membership reads return no row,
    // so this mixed fixture observes 320 rows; the envelope conservatively reserves 384.
    assert.deepEqual(counts, { queries: 384, rowsRead: 320, registered: MAX_NOTIFICATION_CONNECTIONS });
  } finally {
    for (const client of clients) try { client.close(); } catch { /* Native close may already have completed. */ }
    await mf.dispose();
  }
});

async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for native typing delivery');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
