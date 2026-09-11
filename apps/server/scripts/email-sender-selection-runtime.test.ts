import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { SqlChannelsRepository } from '../src/repositories';
import { splitSql } from './split-sql';

const serverRoot = resolve(import.meta.dirname, '..');
test('indexed sender selection uses bounded real D1 reads with colliding tenant/group IDs', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'sender-selection', modules: true,
    script: 'export default {fetch(){return new Response("fixture")}}', d1Databases: ['DB'] }] }));
  try {
    const db = await mf.getD1Database('DB');
    const directory = join(serverRoot, 'migrations');
    for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(directory, file), 'utf8')).map(sql => db.prepare(sql)));
    }
    await db.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<1000)
      INSERT INTO support_emails (tenant_id,id,email_address,normalized_email,group_id,is_default,created_at)
      SELECT 'A','noise-'||n,'noise-'||n||'@example.test','noise-'||n||'@example.test','unrelated',0,'2000-01-01' FROM seq`).run();
    for (const tenant of ['A', 'B']) {
      for (const [id, group, isDefault] of [['group-a', 'target', 0], ['group-z', 'target', 0], ['default', null, 1]] as const) {
        await db.prepare(`INSERT INTO support_emails (tenant_id,id,email_address,normalized_email,group_id,is_default,created_at)
          VALUES (?,?,?,?,?,?,?)`).bind(tenant, id, `${id}-${tenant}@example.test`, `${id}-${tenant.toLowerCase()}@example.test`, group, isDefault, '2026-01-01').run();
      }
    }
    const seen: { sql: string; bindings: unknown[]; rows: number }[] = [];
    const observed = { prepare(sql: string) { return { bind(...bindings: unknown[]) { return { async first() {
      const result = await db.prepare(sql).bind(...bindings).all(); seen.push({ sql, bindings, rows: result.meta.rows_read });
      return result.results[0] ?? null;
    } }; } }; } };
    const repository = (tenant: string) => new SqlChannelsRepository(createVerifiedTenantScope(tenant, 'staff', ['agent'], 1), observed as any);
    assert.equal((await repository('A').findReplySender('target'))?.email_address, 'group-a-A@example.test');
    assert.equal((await repository('B').findReplySender('target'))?.email_address, 'group-a-B@example.test');
    assert.equal((await repository('A').findReplySender('missing'))?.email_address, 'default-A@example.test');
    assert.equal((await repository('B').findReplySender())?.email_address, 'default-B@example.test');
    assert.equal((await repository('A').findByEmail('group-a-b@example.test')), null);
    assert.equal((await repository('A').findByEmail('GROUP-A-A@EXAMPLE.TEST'))?.email_address, 'group-a-A@example.test');
    assert.ok(seen.every(query => query.rows <= 1), JSON.stringify(seen.map(query => query.rows)));
    for (const query of seen.filter(query => query.sql.includes('ORDER BY'))) {
      const plan = await db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).bind(...query.bindings).all();
      const detail = JSON.stringify(plan.results);
      assert.match(detail, /SEARCH support_emails USING INDEX idx_support_emails_tenant_(group|default)_created/);
      assert.doesNotMatch(detail, /SCAN|TEMP B-TREE/);
    }
    await db.prepare("DELETE FROM support_emails WHERE tenant_id='A' AND is_default=1").run();
    assert.equal(await repository('A').findReplySender('missing'), null);
    assert.equal((await repository('B').findReplySender())?.email_address, 'default-B@example.test');
  } finally { await mf.dispose(); }
});
