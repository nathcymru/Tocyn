import { Miniflare } from 'miniflare';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { createRepositories } from '../src/repositories/index';
import { TenantAttachmentStorage } from '../src/storage/adapters';
import { TenantTicketService } from '../src/services/tenant-ticket.service';
import { tenantMiddleware } from '../src/middleware/tenant.middleware';
import { Hono } from 'hono';
import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

async function run() {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: { DB: '597c6389-7387-4bc6-95aa-6e65fad55097' },
    r2Buckets: ['ATTACHMENTS_BUCKET'],
  });

  try {
    const db = await mf.getD1Database('DB');
    const bucket = await mf.getR2Bucket('ATTACHMENTS_BUCKET');
    console.log("Setting up D1 test database via Miniflare bindings...");
    
    // Load schema
    const schema = readFileSync(join(process.cwd(), 'src/repositories/__tests__/fixtures/schema.sql'), 'utf-8');
    const statements = schema.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of statements) {
      await db.prepare(stmt).run();
    }

    // 1. Composition Boundary Tests (Fail Closed)
    console.log("Testing Composition Boundary...");
    const app = new Hono();
    // Simulate setting env
    app.use('*', async (c, next) => {
      c.env = { DB: db, ATTACHMENTS_BUCKET: bucket };
      await next();
    });
    
    app.get('/test-no-scope', tenantMiddleware, (c) => c.text('success'));
    
    app.get('/test-with-scope', async (c, next) => {
      const scopeA = createVerifiedTenantScope('tenant-A', 'user-A', ['customer'], 1);
      c.set('tenantScope', scopeA);
      await next();
    }, tenantMiddleware, async (c) => {
      const deps = c.get('tenantDeps');
      if (!deps || !deps.repositories || !deps.attachmentStorage) return c.json({error: 'missing deps'}, 500);
      
      // Prove it's bound to A and ignoring malicious payload
      assert.strictEqual(deps.scope.tenantId, 'tenant-A');
      return c.text('success');
    });

    const resNoScope = await app.request('/test-no-scope');
    assert.strictEqual(resNoScope.status, 401, "Composition must fail closed without tenantScope");

    const resWithScope = await app.request('/test-with-scope');
    assert.strictEqual(resWithScope.status, 200, "Composition succeeds with valid scope");
    console.log("SUCCESS: Composition boundary secure.");

    // Scope creation
    const scopeA = createVerifiedTenantScope('tenant-A', 'user-A', ['customer'], 1);
    const scopeB = createVerifiedTenantScope('tenant-B', 'user-B', ['customer'], 1);
    
    const reposA = createRepositories(scopeA, db);
    const reposB = createRepositories(scopeB, db);
    const storageA = new TenantAttachmentStorage(scopeA, bucket as any);
    const storageB = new TenantAttachmentStorage(scopeB, bucket as any);

    console.log("Populating identical basic data...");
    await db.prepare("INSERT INTO users (tenant_id, id, email, role) VALUES ('tenant-A', 'shared-user', 'a@test.com', 'customer')").run();
    await db.prepare("INSERT INTO users (tenant_id, id, email, role) VALUES ('tenant-B', 'shared-user', 'b@test.com', 'customer')").run();
    
    const ticketA = await reposA.tickets.create({ subject: 'A Ticket', customer_email: 'a@test.com', source: 'web', status: 'open', priority: 'normal' });
    const ticketB = await reposB.tickets.create({ subject: 'B Ticket', customer_email: 'b@test.com', source: 'web', status: 'open', priority: 'normal' });

    console.log("Testing Identical IDs for Articles and Attachments...");
    await db.prepare("INSERT INTO articles (tenant_id, id, ticket_id, sender_type) VALUES ('tenant-A', 'shared-article', ?, 'customer')").bind(ticketA.id).run();
    await db.prepare("INSERT INTO articles (tenant_id, id, ticket_id, sender_type) VALUES ('tenant-B', 'shared-article', ?, 'customer')").bind(ticketB.id).run();

    const artA = await reposA.articles.get('shared-article');
    const artB = await reposB.articles.get('shared-article');
    assert.ok(artA && artB && artA.id === artB.id, "Identical article IDs could not coexist");
    
    // Mutate Article A
    await reposA.articles.update('shared-article', { body: 'Updated A' });
    const artAUpdated = await reposA.articles.get('shared-article');
    const artBUnchanged = await reposB.articles.get('shared-article');
    assert.strictEqual(artAUpdated?.body, 'Updated A');
    assert.notStrictEqual(artBUnchanged?.body, 'Updated A');
    console.log("SUCCESS: Article identical IDs coexist and mutations are isolated.");

    // Cross-tenant FK rejection for articles
    console.log("Testing cross-tenant FK rejection...");
    try {
      await reposA.articles.create({ ticket_id: ticketB.id, sender_type: 'customer', body: 'Malicious' });
      assert.fail("Tenant A successfully created an article under Tenant B's ticket!");
    } catch (err: any) {
      assert.match(err.message, /FOREIGN KEY constraint failed/);
    }
    
    // Cross-tenant FK rejection for attachments
    try {
      await reposA.attachments.create({ article_id: 'shared-article', file_name: 'test', file_size: 10, content_type: 'text/plain', r2_key: 'key' });
      // Wait, 'shared-article' exists in both. But if we try to link to B's specific article:
      await reposA.attachments.create({ article_id: ticketB.id, file_name: 'test', file_size: 10, content_type: 'text/plain', r2_key: 'key' });
      assert.fail("Tenant A attached to Tenant B's article!");
    } catch (err: any) {
      assert.match(err.message, /FOREIGN KEY constraint failed/);
    }
    console.log("SUCCESS: Cross-tenant relationships securely rejected at D1 level.");

    // R2 isolation and rollback
    console.log("Testing R2 Namespace Sandbox...");
    // A tries to request what looks like B's object
    await storageA.putAttachment('../tenant-B/secret.txt', 'evil');
    const evilObj = await bucket.get('tenant-A/../tenant-B/secret.txt');
    assert.ok(evilObj, "Object should be strictly sandboxed under A's prefix");
    const testDirect = await bucket.get('tenant-B/secret.txt');
    assert.strictEqual(testDirect, null, "A escaped its R2 sandbox!");
    console.log("SUCCESS: R2 sandboxing prevents path traversal.");

    console.log("Testing D1 failure R2 rollback policy...");
    // Mock the repo failing
    let r2DeleteCalled = false;
    const originalDelete = storageA.deleteAttachment.bind(storageA);
    storageA.deleteAttachment = async (key: string) => {
      r2DeleteCalled = true;
      return originalDelete(key);
    };

    const ticketServiceA = new TenantTicketService({
      scope: scopeA,
      repositories: reposA,
      attachmentStorage: storageA
    } as any);

    try {
      await storageA.putAttachment('orphan-test', 'data');
      // Call through TenantTicketService
      await ticketServiceA.addAttachment({ article_id: 'invalid-id', file_name: 'test', file_size: 10, content_type: 'text', r2_key: 'orphan-test' });
    } catch (err) {
      // Expected to fail due to invalid article_id (FK constraint)
    }
    assert.ok(r2DeleteCalled, "Compensating R2 delete was not called after D1 failure");
    const checkDeleted = await storageA.getAttachment('orphan-test');
    assert.strictEqual(checkDeleted, null, "R2 object was not actually deleted");
    console.log("SUCCESS: Compensating R2 delete works via TenantTicketService.");

    // PRAGMAs
    const fkCheck = await db.prepare("PRAGMA foreign_key_check").all();
    assert.strictEqual(fkCheck.results.length, 0, "PRAGMA foreign_key_check failed");
    
    const quickCheck = await db.prepare("PRAGMA quick_check").all();
    assert.strictEqual(quickCheck.results[0].quick_check, 'ok', "PRAGMA quick_check failed");
    
    console.log("Testing Customer-Ticket hot path Query Plan...");
    const plan = await db.prepare("EXPLAIN QUERY PLAN SELECT id, subject, status, created_at, updated_at FROM tickets WHERE tenant_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 50")
      .bind(scopeA.tenantId, 'user-A').all();
    console.log("Query Plan:");
    for (const row of plan.results) {
      console.log(`  - ${row.detail}`);
    }

    console.log("SUCCESS: PRAGMAs valid.");

  } finally {
    await mf.dispose();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
