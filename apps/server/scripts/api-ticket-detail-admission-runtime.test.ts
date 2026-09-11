import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { API_TICKET_DETAIL_ENVELOPE } from '../src/budgets/api-ticket-detail-admission.service';

const root = resolve(import.meta.dirname, '..');
const now = Date.now();
const dimensions = ['workerRequests', 'd1RowsRead', 'd1RowsWritten', 'doRequests', 'doRowsRead', 'doRowsWritten', 'logEvents'] as const;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function fixture(limit = 1_000_000, lowLimit = limit) {
  const bundled = await build({ entryPoints: [resolve(import.meta.dirname, 'budget-admission-runtime-entry.ts')], bundle: true,
    format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'api-detail-admission-proof', modules: true,
    compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
    bindings: { BUDGET_ADMISSION_POLICY: 'api-ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true', JWT_SECRET: 'synthetic-api-detail-secret-at-least-32-chars' },
    d1Databases: { DB: 'api-detail-admission-d1' }, r2Buckets: { ATTACHMENTS_BUCKET: 'api-detail-admission-r2' },
    durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO', NOTIFICATION_DO: 'NotificationDO' },
    unsafeEphemeralDurableObjects: true,
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    for (const migration of readdirSync(join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(root, 'migrations', migration), 'utf8')).map(sql => db.prepare(sql)));
    }
    const limits = Object.fromEntries(dimensions.map(dimension => [dimension, limit]));
    const lowLimits = Object.fromEntries(dimensions.map(dimension => [dimension, lowLimit]));
    const owner = { schemaVersion: 1, policyId: 'api-detail-policy', revision: 1, deploymentId: 'api-detail-deployment',
      mode: 'conservative', catalogueVersion: 'synthetic-2026-09', maxGrantLifetimeMs: 60_000,
      budgets: dimensions.map(dimension => ({ dimension, limit: limits[dimension], allocationId: `detail-${dimension}`,
        recoveryPercent: 20, provenance: 'owner-allocation', window: { kind: 'interval', id: 'detail-window', startsAt: now - 1, endsAt: now + 60_000 } })) };
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('api-detail-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES ('api-detail-deployment','api-detail-policy',1,1,'api-detail-coordinator',64,30000,?)`).bind(JSON.stringify(owner)),
    ]);
    const keys: Record<string, { value: string; id: string }> = {};
    for (const tenantId of ['detail-a', 'detail-b', 'detail-low']) {
      const restriction = { schemaVersion: 1, tenantId, ownerPolicyId: owner.policyId, ownerPolicyRevision: 1, revision: 1,
        mode: 'conservative', limits: tenantId === 'detail-low' ? lowLimits : limits, disabledFeatures: [] };
      const value = `lt_${tenantId.replace('-', '')}.synthetic-detail-key-123456789012`;
      const id = 'shared-api-key'; keys[tenantId] = { value, id };
      await db.batch([
        db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'customer',?,'customer',1,0)").bind(tenantId, `${tenantId}@example.test`),
        db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES (?,'shared-ticket','Synthetic detail',?,'api')").bind(tenantId, `${tenantId}@example.test`),
        db.prepare("INSERT INTO api_keys (tenant_id,id,name,key_hash,prefix,permissions,is_active,created_at) VALUES (?,?,'Synthetic detail key',?,'lt_synth','tickets:read',1,?)")
          .bind(tenantId, id, await sha256(value), new Date(now).toISOString()),
        db.prepare(`INSERT INTO budget_tenant_allocations (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
          VALUES ('api-detail-deployment',?,'api-detail-policy',1,1,?,?,'active')`).bind(tenantId, `detail-${tenantId}`, JSON.stringify(restriction)),
      ]);
    }
    return { mf, db, keys };
  } catch (error) { await mf.dispose(); throw error; }
}

function detail(mf: Miniflare, key: string, path = '/api/v1/tickets/shared-ticket') {
  return mf.dispatchFetch(`http://runtime.test${path}`, { headers: { 'X-API-Key': key } });
}

async function addArticles(db: any, tenantId: string, ticketId: string, count: number, body = 'Synthetic public reply') {
  await db.batch(Array.from({ length: count }, (_, index) => db.prepare(`INSERT INTO articles
    (tenant_id,id,ticket_id,sender_id,sender_type,body,is_internal,intake_source)
    VALUES (?,?,?,'customer','customer',?,0,'api')`).bind(tenantId, `article-${String(index + 1).padStart(3, '0')}`, ticketId, body)));
}

test('API detail admits a default 50-article public page with a cursor and bounded queries', async () => {
  const f = await fixture();
  try {
    await f.db.batch(Array.from({ length: 3_000 }, (_, index) => f.db.prepare(`INSERT INTO articles
      (tenant_id,id,ticket_id,sender_type,body,is_internal,intake_source)
      VALUES ('detail-a',?,'shared-ticket','agent','Hidden',1,'api')`).bind(`hidden-${String(index).padStart(4, '0')}`)));
    await addArticles(f.db, 'detail-a', 'shared-ticket', 51);
    await f.db.prepare(`INSERT INTO conversation_events
      (tenant_id,id,ticket_id,article_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts)
      VALUES ('detail-a','intake-event','shared-ticket','article-001',1,'ticket.intake','api-key','shared-api-key','api-key','api','public','{}')`).run();
    const first = await detail(f.mf, f.keys['detail-a'].value);
    assert.equal(first.status, 200, await first.clone().text());
    const page = await first.json() as { articles: { id: string }[]; canonical: { messages: unknown[] }; pagination: { next_cursor: string | null; has_more: boolean } };
    assert.equal(page.articles.length, 50); assert.equal(page.canonical.messages.length, 50);
    assert.ok(page.pagination.has_more); assert.ok(page.pagination.next_cursor);
    const tail = await detail(f.mf, f.keys['detail-a'].value, `/api/v1/tickets/shared-ticket?article_cursor=${page.pagination.next_cursor}`);
    assert.equal(tail.status, 200, await tail.clone().text());
    const tailPage = await tail.json() as { articles: unknown[]; canonical: { conversation: { audit?: { status: string; value?: { eventId: string } } } } };
    assert.equal(tailPage.articles.length, 1);
    assert.equal(tailPage.canonical.conversation.audit?.status, 'known', 'the current public intake remains known off-page');
    assert.equal(tailPage.canonical.conversation.audit?.value?.eventId, 'intake-event');
    const control = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {
      calls: { refresh: number; reserve: number }; detailArticleMetadataQueries: number; detailArticleRowsRead: number;
      detailAttachmentRowsRead: number; detailReferenceRowsRead: number; r2Gets: number;
    };
    assert.deepEqual(control.calls, { refresh: 1, reserve: 1, revoke: 0, reconcile: 0 });
    assert.equal(control.detailArticleMetadataQueries, 2);
    // The 3,000-row hidden prefix is excluded by the visibility-leading index.
    // Each page remains a 51-row sentinel query plus its bounded ownership work.
    assert.ok(control.detailArticleRowsRead <= 204, String(control.detailArticleRowsRead));
    assert.ok(control.detailAttachmentRowsRead <= 8, String(control.detailAttachmentRowsRead));
    assert.ok(control.detailReferenceRowsRead <= 110, String(control.detailReferenceRowsRead));
    assert.ok((API_TICKET_DETAIL_ENVELOPE.d1RowsRead ?? 0) >= control.detailArticleRowsRead + control.detailAttachmentRowsRead + control.detailReferenceRowsRead);
    assert.equal(control.r2Gets, 0, 'bounded detail retrieval never hydrates legacy R2 bodies');
    const [articlePlan, attachmentPlan, intakePlan, replyPlan] = await Promise.all([
      f.db.prepare(`EXPLAIN QUERY PLAN SELECT a.id FROM articles a WHERE a.tenant_id=? AND a.ticket_id=?
        AND a.is_internal=0 ORDER BY a.created_at,a.id LIMIT 51`).bind('detail-a', 'shared-ticket').all<{ detail: string }>(),
      f.db.prepare(`EXPLAIN QUERY PLAN SELECT x.* FROM attachments x WHERE x.tenant_id=? AND x.article_id IN (?,?) LIMIT 501`)
        .bind('detail-a', 'article-001', 'article-002').all<{ detail: string }>(),
      f.db.prepare(`EXPLAIN QUERY PLAN SELECT e.id FROM conversation_events e WHERE e.tenant_id=? AND e.ticket_id=?
        AND e.kind='ticket.intake' AND e.visibility='public' AND EXISTS
        (SELECT 1 FROM conversation_public_history p WHERE p.tenant_id=e.tenant_id AND p.event_id=e.id)
        ORDER BY e.sequence LIMIT 2`).bind('detail-a', 'shared-ticket').all<{ detail: string }>(),
      f.db.prepare(`EXPLAIN QUERY PLAN SELECT e.id FROM conversation_events e WHERE e.tenant_id=? AND e.ticket_id=?
        AND e.kind='message.reply' AND e.article_id IN (?,?) AND EXISTS
        (SELECT 1 FROM conversation_public_history p WHERE p.tenant_id=e.tenant_id AND p.event_id=e.id) LIMIT 51`)
        .bind('detail-a', 'shared-ticket', 'article-001', 'article-002').all<{ detail: string }>(),
    ]);
    const details = [articlePlan, attachmentPlan, intakePlan, replyPlan].flatMap(plan => plan.results.map(row => row.detail));
    assert.ok(details.some(detail => detail.includes('idx_articles_tenant_ticket_visibility_created_id')), details.join('\n'));
    assert.ok(details.some(detail => detail.includes('idx_attachments_tenant_article_created_id')), details.join('\n'));
    assert.ok(details.some(detail => detail.includes('idx_conversation_events_ticket_kind_visibility_sequence')), details.join('\n'));
    assert.ok(details.some(detail => detail.includes('idx_conversation_events_ticket_article_kind')), details.join('\n'));
    assert.ok(details.every(detail => !detail.includes('USE TEMP B-TREE')), details.join('\n'));
  } finally { await f.mf.dispose(); }
});

test('API detail denies foreign, missing, malformed, exhausted, and freshly revoked requests before article work', async () => {
  const f = await fixture(1_000_000, 1);
  try {
    await f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES ('detail-b','b-only','Other tenant','detail-b@example.test','api')").run();
    const foreign = await detail(f.mf, f.keys['detail-a'].value, '/api/v1/tickets/b-only');
    assert.equal(foreign.status, 404); await foreign.body?.cancel();
    const missing = await detail(f.mf, f.keys['detail-a'].value, '/api/v1/tickets/missing');
    assert.equal(missing.status, 404); await missing.body?.cancel();
    const malformed = await detail(f.mf, f.keys['detail-a'].value, '/api/v1/tickets/shared-ticket?article_cursor=not-a-cursor');
    assert.equal(malformed.status, 400); await malformed.body?.cancel();
    const exhausted = await detail(f.mf, f.keys['detail-low'].value);
    assert.equal(exhausted.status, 429); await exhausted.body?.cancel();
    await f.mf.dispatchFetch('http://runtime.test/__budget-control', { method: 'POST', body: JSON.stringify({
      revokeApiKeyAfterAuth: { tenantId: 'detail-b', apiKeyId: 'shared-api-key' },
    }) });
    const revoked = await detail(f.mf, f.keys['detail-b'].value);
    assert.equal(revoked.status, 503); await revoked.body?.cancel();
    const control = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { detailArticleMetadataQueries: number };
    assert.equal(control.detailArticleMetadataQueries, 0, 'denied detail attempts never reach the article metadata query');
  } finally { await f.mf.dispose(); }
});

test('API detail follows current public visibility and rejects oversized bodies or attachments without R2 fallback', async () => {
  const f = await fixture();
  try {
    await f.db.batch([
      f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES ('detail-a','visibility-ticket','Visibility','detail-a@example.test','api')"),
      f.db.prepare("INSERT INTO articles (tenant_id,id,ticket_id,sender_type,body,is_internal) VALUES ('detail-a','public','visibility-ticket','customer','Public',0)"),
      f.db.prepare("INSERT INTO articles (tenant_id,id,ticket_id,sender_type,body,is_internal) VALUES ('detail-a','hidden','visibility-ticket','agent','Hidden',1)"),
    ]);
    const publicOnly = await detail(f.mf, f.keys['detail-a'].value, '/api/v1/tickets/visibility-ticket');
    assert.equal(publicOnly.status, 200); assert.deepEqual((await publicOnly.json() as { articles: { id: string }[] }).articles.map(article => article.id), ['public']);
    await f.db.prepare("UPDATE articles SET is_internal=0 WHERE tenant_id='detail-a' AND id='hidden'").run();
    const exposed = await detail(f.mf, f.keys['detail-a'].value, '/api/v1/tickets/visibility-ticket');
    assert.equal(exposed.status, 200); assert.deepEqual((await exposed.json() as { articles: { id: string }[] }).articles.map(article => article.id), ['hidden', 'public']);
    await f.db.batch([
      f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES ('detail-a','attachment-order-ticket','Attachment order','detail-a@example.test','api')"),
      f.db.prepare("INSERT INTO articles (tenant_id,id,ticket_id,sender_type,body,is_internal) VALUES ('detail-a','attachment-order-article','attachment-order-ticket','customer','Small',0)"),
      f.db.prepare("INSERT INTO attachments (tenant_id,id,article_id,file_name,file_size,content_type,r2_key,created_at) VALUES ('detail-a','a-lower','attachment-order-article','a.txt',1,'text/plain','detail-a/a','2026-09-11 00:00:00')"),
      f.db.prepare("INSERT INTO attachments (tenant_id,id,article_id,file_name,file_size,content_type,r2_key,created_at) VALUES ('detail-a','Z-upper','attachment-order-article','z.txt',1,'text/plain','detail-a/z','2026-09-11 00:00:00')"),
    ]);
    const ordered = await detail(f.mf, f.keys['detail-a'].value, '/api/v1/tickets/attachment-order-ticket');
    assert.equal(ordered.status, 200);
    const orderedBody = await ordered.json() as { canonical: { messages: { id: string; attachments: { id: string }[] }[] } };
    assert.deepEqual(orderedBody.canonical.messages.find(message => message.id === 'attachment-order-article')?.attachments.map(attachment => attachment.id),
      ['Z-upper', 'a-lower'], 'bounded attachment assembly retains SQLite BINARY ordering');
    await f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES ('detail-a','large-ticket','Large','detail-a@example.test','api')").run();
    await f.db.prepare("INSERT INTO articles (tenant_id,id,ticket_id,sender_type,body,body_r2_key,is_internal) VALUES ('detail-a','legacy','large-ticket','customer',NULL,'tenant/detail-a/legacy',0)").run();
    const legacy = await detail(f.mf, f.keys['detail-a'].value, '/api/v1/tickets/large-ticket');
    assert.equal(legacy.status, 413); assert.equal((await legacy.json() as { code: string }).code, 'conversation_page_too_large');
    await f.db.prepare("UPDATE articles SET body_r2_key=NULL,body=? WHERE tenant_id='detail-a' AND id='legacy'").bind('x'.repeat(300 * 1024)).run();
    const oversized = await detail(f.mf, f.keys['detail-a'].value, '/api/v1/tickets/large-ticket');
    assert.equal(oversized.status, 413); assert.equal((await oversized.json() as { code: string }).code, 'conversation_page_too_large');
    await f.db.batch([
      f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES ('detail-a','attachments-ticket','Attachments','detail-a@example.test','api')"),
      f.db.prepare("INSERT INTO articles (tenant_id,id,ticket_id,sender_type,body,is_internal) VALUES ('detail-a','attachment-article','attachments-ticket','customer','Small',0)"),
    ]);
    await f.db.batch(Array.from({ length: 501 }, (_, index) => f.db.prepare(`INSERT INTO attachments
      (tenant_id,id,article_id,file_name,file_size,content_type,r2_key)
      VALUES ('detail-a',?,'attachment-article','synthetic.txt',1,'text/plain',?)`)
      .bind(`attachment-${String(index).padStart(3, '0')}`, `detail-a/attachment-${index}`)));
    const attachmentOverflow = await detail(f.mf, f.keys['detail-a'].value, '/api/v1/tickets/attachments-ticket');
    assert.equal(attachmentOverflow.status, 413);
    assert.equal((await attachmentOverflow.json() as { code: string }).code, 'conversation_page_too_large');
    const control = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { r2Gets: number };
    assert.equal(control.r2Gets, 0);
  } finally { await f.mf.dispose(); }
});

test('API detail rejects oversized legacy attachment metadata before full attachment hydration', async () => {
  const f = await fixture();
  try {
    await f.db.batch([
      f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES ('detail-a','legacy-attachment-ticket','Legacy attachment','detail-a@example.test','api')"),
      f.db.prepare("INSERT INTO articles (tenant_id,id,ticket_id,sender_type,body,is_internal) VALUES ('detail-a','legacy-attachment-article','legacy-attachment-ticket','customer','Small',0)"),
      f.db.prepare("INSERT INTO attachments (tenant_id,id,article_id,file_name,file_size,content_type,r2_key) VALUES ('detail-a','legacy-attachment','legacy-attachment-article','legacy.txt',1,'text/plain',?)")
        .bind(`detail-a/${'x'.repeat(300 * 1024)}`),
    ]);
    const response = await detail(f.mf, f.keys['detail-a'].value, '/api/v1/tickets/legacy-attachment-ticket');
    assert.equal(response.status, 413);
    assert.equal((await response.json() as { code: string }).code, 'conversation_page_too_large');
    const control = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {
      detailAttachmentMetadataQueries: number; detailAttachmentRowsRead: number; r2Gets: number;
    };
    assert.equal(control.detailAttachmentMetadataQueries, 1);
    assert.equal(control.detailAttachmentRowsRead, 0, 'oversized attachment strings are never materialized for the response');
    assert.equal(control.r2Gets, 0);
  } finally { await f.mf.dispose(); }
});
