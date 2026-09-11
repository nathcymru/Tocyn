import assert from 'node:assert/strict';
import test from 'node:test';
import { withTwoTenantFixture, type LocalTenantFixture } from './local-tenant-fixture';
import { guardedFixture, betaCounters } from './local-beta-fixture';

function create(f: LocalTenantFixture, key: string, retry: string, subject: string, ip: string) {
  return f.request('/api/v1/tickets', { method: 'POST', apiKey: key, idempotencyKey: retry, body: { subject, body: 'Synthetic accepted message', customer_email: f.principals.customerA.email }, ip: f.rateLimitIdentity + ip });
}
async function effects(f: LocalTenantFixture) {
  const counts: Record<string, number> = {};
  for (const table of ['tickets', 'articles', 'attachments', 'conversation_events', 'ticket_mutation_receipts']) counts[table] = (await f.db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number ;}>())!.n;
  return { counts, counters: await betaCounters(f) };
}
async function staffToken(f: LocalTenantFixture) {
  const challenge = await (await f.login('operatorA')).json<{ token: string ;}>();
  const verified = await f.request('/api/auth/mfa/verify', { method: 'POST', token: challenge.token, body: { code: f.currentMfaCode('operatorA') } }); assert.equal(verified.status, 200);
  return (await verified.json<{ token: string ;}>()).token;
}

test('integrated beta: concurrent cross-tenant last-slot creates and same-key recovery never overcharge', async t => {
  await withTwoTenantFixture(async f => {
    const keys = await guardedFixture(f);
    assert.equal((await create(f, keys.a.apiKey, 'first', 'First accepted', '-first')).status, 201);
    const race = await Promise.all([create(f, keys.a.apiKey, 'a-last', 'A candidate', '-a'), create(f, keys.b.apiKey, 'b-last', 'B candidate', '-b')]);
    assert.deepEqual(race.map(r => r.status).sort(), [201, 429]);
    assert.deepEqual(await betaCounters(f), { tickets: 2, mutations: 2, upload_attempts: 0 });
    t.diagnostic(JSON.stringify({ tenants: 2, lastSlotContenders: 2, committedAtLastSlot: 1, ceilingExceeded: false }));
  });
  await withTwoTenantFixture(async f => {
    const keys = await guardedFixture(f, { ticketLimit: 1, mutationLimit: 2, recoveryReserve: 1, uploadLimit: 2 });
    const race = await Promise.all([create(f, keys.a.apiKey, 'same-last', 'One logical mutation', '-one'), create(f, keys.a.apiKey, 'same-last', 'One logical mutation', '-two')]);
    assert.deepEqual(race.map(r => r.status), [201, 201]);
    assert.deepEqual(race.map(r => r.headers.get('Idempotency-Replayed')).sort(), ['false', 'true']);
    assert.deepEqual(await race[0].json(), await race[1].json());
    assert.deepEqual(await betaCounters(f), { tickets: 1, mutations: 1, upload_attempts: 0 });
    assert.equal((await create(f, keys.a.apiKey, 'same-last', 'Conflicting payload', '-conflict')).status, 409);
    await f.db.prepare("UPDATE local_beta_policy SET state='writes_stopped',revision=revision+1 WHERE singleton=1").run();
    const replay = await create(f, keys.a.apiKey, 'same-last', 'One logical mutation', '-stopped'); assert.equal(replay.status, 201); assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
    await f.db.prepare("DELETE FROM local_beta_invitations WHERE principal_kind='api-key' AND principal_id=?").bind(keys.a.id).run();
    assert.equal((await create(f, keys.a.apiKey, 'same-last', 'One logical mutation', '-revoked')).status, 403);
    assert.deepEqual(await betaCounters(f), { tickets: 1, mutations: 1, upload_attempts: 0 });
  });
});

test('integrated beta: injected batch failures retain no counter, mutation, audit or receipt; fresh retry is safe', async t => {
  await withTwoTenantFixture(async f => {
    const keys = await guardedFixture(f);
    const before = await effects(f);
    for (const table of ['local_beta_assertion', 'tickets', 'articles', 'conversation_events', 'ticket_mutation_receipts']) {
      await f.db.prepare(`CREATE TRIGGER beta_synthetic_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic batch failure'); END`).run();
      const response = await create(f, keys.a.apiKey, 'retry-after-failure', 'Only after recovery', '-failure-' + table);
      assert.equal(response.status, 503, table); await response.body?.cancel();
      assert.deepEqual(await effects(f), before, table);
      await f.db.prepare('DROP TRIGGER beta_synthetic_failure').run();
    }
    assert.equal((await create(f, keys.a.apiKey, 'retry-after-failure', 'Only after recovery', '-recovered')).status, 201);
    assert.deepEqual(await betaCounters(f), { tickets: 1, mutations: 1, upload_attempts: 0 });
    t.diagnostic(JSON.stringify({ injectedFailureStages: 5, partialCounters: 0, partialMutations: 0, partialEvents: 0, recoveredCommit: 1 }));
  });
});

test('integrated beta: recovery reserve, material/no-op PATCH, stop/resume and accepted reads', async () => {
  await withTwoTenantFixture(async f => {
    const keys = await guardedFixture(f, { ticketLimit: 1, mutationLimit: 3, recoveryReserve: 2, uploadLimit: 2 });
    const token = await staffToken(f);
    const accepted = await create(f, keys.a.apiKey, 'accepted', 'Preserve conversation', '-create'); assert.equal(accepted.status, 201);
    const ticket = await accepted.json<{ id: string ;}>();
    assert.equal((await create(f, keys.a.apiKey, 'blocked', 'No new intake', '-blocked')).status, 429);
    const patch = () => f.request('/api/tickets/' + ticket.id, { method: 'PATCH', token, body: { status: 'pending' } });
    assert.equal((await patch()).status, 200); assert.deepEqual(await betaCounters(f), { tickets: 1, mutations: 2, upload_attempts: 0 });
    assert.equal((await patch()).status, 200); assert.deepEqual(await betaCounters(f), { tickets: 1, mutations: 2, upload_attempts: 0 });
    await f.db.prepare("UPDATE local_beta_policy SET state='intake_stopped',revision=revision+1 WHERE singleton=1").run();
    const reply = await f.request('/api/tickets/' + ticket.id + '/articles', { method: 'POST', token, body: { body: 'Accepted-work recovery reply', is_internal: false }, ip: f.rateLimitIdentity + '-recovery' }); assert.equal(reply.status, 201);
    assert.deepEqual(await betaCounters(f), { tickets: 1, mutations: 3, upload_attempts: 0 });
    await f.db.prepare("UPDATE local_beta_policy SET state='writes_stopped',revision=revision+1 WHERE singleton=1").run();
    assert.equal((await patch()).status, 200, 'Stopped no-op neither charges nor modifies accepted work');
    const stopped = await f.request('/api/tickets/' + ticket.id, { method: 'PATCH', token, body: { status: 'closed' } }); assert.equal(stopped.status, 503);
    assert.equal((await f.request('/api/tickets/' + ticket.id, { token })).status, 200);
    f.restartLocalRuntime();
    assert.equal((await f.request('/api/v1/tickets/' + ticket.id, { apiKey: keys.a.apiKey })).status, 200);
    await f.db.prepare("UPDATE local_beta_policy SET state='running',revision=revision+1 WHERE singleton=1").run();
    assert.equal((await f.request('/api/tickets/' + ticket.id, { method: 'PATCH', token, body: { status: 'closed' } })).status, 429, 'Resume does not reset an exhausted mutation counter');
    assert.deepEqual(await betaCounters(f), { tickets: 1, mutations: 3, upload_attempts: 0 });
  });
});

test('integrated beta: stopped and exhausted uploads make zero R2 calls; uncertain attempts never delete accepted objects', async () => {
  await withTwoTenantFixture(async f => {
    await guardedFixture(f);
    const token = await staffToken(f);
    const upload = (idempotencyKey?: string) => { const form = new FormData(); form.append('file', new Blob(['synthetic safe attachment'], { type: 'text/plain' }), 'safe.txt'); return f.request('/api/attachments/upload', { method: 'POST', token, rawBody: form, contentType: null, idempotencyKey }); };
    const accepted = await upload(); assert.equal(accepted.status, 200); const key = (await accepted.json<{ key: string ;}>()).key;
    const beforeAttachment = await effects(f);
    await f.db.prepare("CREATE TRIGGER beta_attachment_failure BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT,'synthetic attachment failure'); END").run();
    const failedReply = await f.request('/api/tickets/fixture-ticket/articles', {
      method: 'POST', token,
      body: { body: 'Rollback attachment commit', attachments: [{ filename: 'safe.txt', storageKey: key }] },
      ip: f.rateLimitIdentity + '-attachment-failure',
    });
    assert.equal(failedReply.status, 503);
    assert.deepEqual(await effects(f), beforeAttachment);
    await f.db.prepare('DROP TRIGGER beta_attachment_failure').run();
    const reply = await f.request('/api/tickets/fixture-ticket/articles', { method: 'POST', token, body: { body: 'Preserve this attachment', attachments: [{ filename: 'safe.txt', storageKey: key }] }, ip: f.rateLimitIdentity + '-attach' }); assert.equal(reply.status, 201);
    const saved = await effects(f);
    f.r2.failNextPut(true);
    const recoveredUpload = await upload();
    assert.equal(recoveredUpload.status, 200, 'a matching durable marker confirms the accepted write after a lost acknowledgement');
    assert.ok((await recoveredUpload.json<{ key: string }>()).key);
    assert.equal((await betaCounters(f))!.upload_attempts, 2);
    const before = f.r2.operationCounts(); assert.equal((await upload()).status, 429); assert.deepEqual(f.r2.operationCounts(), before);
    assert.equal((await upload('exhausted-keyed-upload')).status, 429);
    assert.deepEqual(f.r2.operationCounts(), before, 'keyed marker lookup also respects exhausted beta upload admission');
    assert.equal(before.delete, 0, 'Ambiguous put failure must never delete a potentially accepted object');
    const persisted = await f.db.prepare("SELECT id FROM attachments WHERE tenant_id=? AND r2_key=?").bind(f.principals.operatorA.tenantId, key).first<{ id: string ;}>(); assert.ok(persisted);
    assert.equal((await f.request('/api/attachments/' + persisted.id + '/download', { token })).status, 200);
    assert.deepEqual((await effects(f)).counts, saved.counts);
    await f.db.prepare("UPDATE local_beta_policy SET state='writes_stopped',revision=revision+1 WHERE singleton=1").run();
    const after = f.r2.operationCounts(); assert.equal((await upload()).status, 503); assert.deepEqual(f.r2.operationCounts(), after);
    assert.equal((await upload('stopped-keyed-upload')).status, 503);
    assert.deepEqual(f.r2.operationCounts(), after, 'stopped uploads cannot probe keyed storage markers');
  });
});

test('integrated beta: marker-only replay and conflict retain their prepaid upload attempts', async () => {
  await withTwoTenantFixture(async f => {
    await guardedFixture(f, { ticketLimit: 2, mutationLimit: 4, recoveryReserve: 2, uploadLimit: 3 });
    const token = await staffToken(f);
    const upload = (body: string) => {
      const form = new FormData();
      form.append('file', new Blob([body], { type: 'text/plain' }), 'safe.txt');
      return f.request('/api/attachments/upload', { method: 'POST', token, rawBody: form,
        contentType: null, idempotencyKey: 'marker-only-upload' });
    };
    const before = f.r2.operationCounts();
    assert.equal((await upload('original')).status, 200);
    assert.equal((await upload('original')).status, 200);
    assert.equal((await upload('conflicting content')).status, 409);
    assert.equal((await betaCounters(f))!.upload_attempts, 3);
    const after = { ...before, get: before.get + 3, put: before.put + 1 };
    assert.deepEqual(f.r2.operationCounts(), after);
    assert.equal((await upload('original')).status, 429);
    assert.deepEqual(f.r2.operationCounts(), after, 'An exhausted replay cannot read even its own marker');
  });
});

for (const channel of ['staff', 'customer'] as const) {
  for (const boundary of ['last-slot', 'stop'] as const) {
    test(`integrated beta: ${channel} upload charges before a concurrent ${boundary} marker read`, { timeout: 30_000 }, async () => {
      await withTwoTenantFixture(async f => {
        await guardedFixture(f, { ticketLimit: 2, mutationLimit: 4, recoveryReserve: 2, uploadLimit: 1 });
        let token: string;
        if (channel === 'staff') token = await staffToken(f);
        else {
          const principal = f.principals.customerA;
          const challenge = await f.request('/api/v1/customer/auth/request', { method: 'POST',
            body: { email: principal.email, widgetKey: principal.widgetKey }, ip: f.rateLimitIdentity + '-upload-auth' });
          assert.equal(challenge.status, 200);
          const messages = await (await f.request('/__local/auth-capture/messages')).json<{ loginLink: string }[]>();
          const verified = await f.request('/api/v1/customer/auth/verify', { method: 'POST',
            body: { token: new URL(messages[0].loginLink).searchParams.get('token'), widgetKey: principal.widgetKey },
            ip: f.rateLimitIdentity + '-upload-verify' });
          assert.equal(verified.status, 200);
          token = (await verified.json<{ token: string }>()).token;
        }
        const upload = (idempotencyKey: string) => {
          const form = new FormData();
          form.append('file', new Blob(['synthetic concurrent upload'], { type: 'text/plain' }), 'safe.txt');
          return f.request(channel === 'staff' ? '/api/attachments/upload' : '/api/v1/customer/attachments/upload', {
            method: 'POST', token, rawBody: form, contentType: null, idempotencyKey,
          });
        };
        const before = f.r2.operationCounts();
        const pause = f.r2.pauseNextGet();
        const first = upload('first-prepaid-upload');
        try {
          await Promise.race([pause.started, first.then(response => { throw new Error(`Upload ended before marker read: ${response.status}`); })]);
          // The first upload is admitted, but has not put any object. A second
          // upload must not consume the same slot or observe a storage marker.
          if (boundary === 'stop') await f.db.prepare("UPDATE local_beta_policy SET state='writes_stopped',revision=revision+1 WHERE singleton=1").run();
          const second = await upload('second-competing-upload');
          assert.equal(second.status, boundary === 'stop' ? 503 : 429);
          assert.equal((await betaCounters(f))!.upload_attempts, 1);
          assert.deepEqual(f.r2.operationCounts(), { ...before, get: before.get + 1 });
        } finally { pause.release(); await first; }
        assert.equal((await first).status, 200, 'An attempt charged before the boundary can finish without being charged twice');
        assert.equal((await betaCounters(f))!.upload_attempts, 1);
        assert.deepEqual(f.r2.operationCounts(), { ...before, get: before.get + 1, put: before.put + 1 });
      });
    });
  }
}

test('integrated bounded detail preserves page-independent visible intake audit and exposes only display user fields', async () => {
  await withTwoTenantFixture(async f => {
    const keys = await guardedFixture(f, { ticketLimit: 2, mutationLimit: 10, recoveryReserve: 2, uploadLimit: 2 });
    const token = await staffToken(f);
    const first = await create(f, keys.a.apiKey, 'paged-audit', 'A paged conversation', '-paged'); assert.equal(first.status, 201);
    const created = await first.json<{ id: string; canonical: { conversation: { audit: unknown ;}; messages: { id: string ;}[] ;} ;}>();
    const intake = created.canonical.conversation.audit;
    const reply = await f.request(`/api/v1/tickets/${created.id}/articles`, { method: 'POST', apiKey: keys.a.apiKey, idempotencyKey: 'paged-reply', body: { body: 'A later visible reply' }, ip: f.rateLimitIdentity + '-paged-reply' }); assert.equal(reply.status, 201);
    // Same-second timestamps are intentionally supported: fix their order deterministically for this projection check.
    await f.db.prepare("UPDATE articles SET created_at='2026-09-09 00:00:00' WHERE tenant_id=? AND id=?").bind(f.principals.customerA.tenantId, created.canonical.messages[0].id).run();
    const page1 = await (await f.request(`/api/v1/tickets/${created.id}?article_limit=1`, { apiKey: keys.a.apiKey })).json<{ pagination: { next_cursor: string ;}; canonical: { conversation: { audit: unknown ;} ;} ;}>();
    assert.deepEqual(page1.canonical.conversation.audit, intake);
    const page2 = await (await f.request(`/api/v1/tickets/${created.id}?article_limit=1&article_cursor=${page1.pagination.next_cursor}`, { apiKey: keys.a.apiKey })).json<{ canonical: { conversation: { audit: unknown ;}; messages: unknown[] ;} ;}>();
    assert.equal(page2.canonical.messages.length, 1); assert.deepEqual(page2.canonical.conversation.audit, intake);
    await f.db.prepare('UPDATE articles SET is_internal=1 WHERE tenant_id=? AND id=?').bind(f.principals.customerA.tenantId, created.canonical.messages[0].id).run();
    const hidden = await (await f.request(`/api/v1/tickets/${created.id}?article_limit=1`, { apiKey: keys.a.apiKey })).json<{ canonical: { conversation: { audit: { status: string ;} ;} ;} ;}>();
    assert.notEqual(hidden.canonical.conversation.audit.status, 'known');
    await f.db.prepare("UPDATE tickets SET customer_id='fixture-customer',assigned_to='fixture-operator' WHERE tenant_id=? AND id=?").bind(f.principals.customerA.tenantId, created.id).run();
    const detail = await f.request('/api/tickets/' + created.id, { token }); assert.equal(detail.status, 200);
    const display = await detail.json<{ customer: Record<string, unknown>; assignee: Record<string, unknown> ;}>();
    for (const user of [display.customer, display.assignee]) {
      assert.deepEqual(Object.keys(user).sort(), ['email', 'full_name', 'id', 'role']);
      assert.equal(Object.hasOwn(user, 'password_hash'), false); assert.equal(Object.hasOwn(user, 'mfa_secret'), false);
    }
    // Oversized inherited data must be rejected before a material API transition can commit.
    await f.db.prepare('UPDATE tickets SET custom_fields=? WHERE tenant_id=? AND id=?').bind(JSON.stringify({ legacy: 'x'.repeat(1024 * 1024) }), f.principals.customerA.tenantId, created.id).run();
    const before = await effects(f);
    const bounded = await f.request('/api/v1/tickets/' + created.id, { method: 'PATCH', apiKey: keys.a.apiKey, body: { status: 'closed' } }); assert.equal(bounded.status, 413);
    assert.deepEqual(await effects(f), before);
    const stored = await f.db.prepare('SELECT status FROM tickets WHERE tenant_id=? AND id=?').bind(f.principals.customerA.tenantId, created.id).first<{ status: string ;}>(); assert.equal(stored?.status, 'open');
  });
});

test('ordinary dashboard detail uses the same minimal display-user projection', async () => {
  await withTwoTenantFixture(async f => {
    const token = await staffToken(f);
    await f.db.prepare("UPDATE tickets SET customer_id='fixture-customer',assigned_to='fixture-operator' WHERE tenant_id=? AND id='fixture-ticket'")
      .bind(f.principals.operatorA.tenantId).run();
    const response = await f.request('/api/tickets/fixture-ticket', { token });
    assert.equal(response.status, 200);
    const detail = await response.json<{ customer: Record<string, unknown>; assignee: Record<string, unknown> }>();
    for (const user of [detail.customer, detail.assignee]) {
      assert.deepEqual(Object.keys(user).sort(), ['email', 'full_name', 'id', 'role']);
      assert.equal(Object.hasOwn(user, 'password_hash'), false);
      assert.equal(Object.hasOwn(user, 'mfa_secret'), false);
    }
  });
});

test('integrated beta expiry reuse charges once and removed results never restore capacity', async () => {
  await withTwoTenantFixture(async f => {
    const keys = await guardedFixture(f, { ticketLimit: 3, mutationLimit: 5, recoveryReserve: 2, uploadLimit: 2 });
    const first = await create(f, keys.a.apiKey, 'expiry-beta', 'First accepted result', '-expiry-first');
    assert.equal(first.status, 201);
    await f.db.prepare('UPDATE ticket_mutation_receipts SET created_at=unixepoch()-86402,expires_at=unixepoch()-1 WHERE tenant_id=?')
      .bind(f.principals.customerA.tenantId).run();
    const race = await Promise.all([
      create(f, keys.a.apiKey, 'expiry-beta', 'Second accepted result', '-expiry-a'),
      create(f, keys.a.apiKey, 'expiry-beta', 'Second accepted result', '-expiry-b'),
    ]);
    assert.deepEqual(race.map(response => response.status), [201, 201]);
    const winner = await race[0].json<{ id: string }>();
    await race[1].body?.cancel();
    assert.deepEqual(await betaCounters(f), { tickets: 2, mutations: 2, upload_attempts: 0 });
    await f.db.prepare('DELETE FROM articles WHERE tenant_id=? AND ticket_id=?')
      .bind(f.principals.customerA.tenantId, winner.id).run();
    const removed = await create(f, keys.a.apiKey, 'expiry-beta', 'Second accepted result', '-expiry-gone');
    assert.equal(removed.status, 410);
    assert.deepEqual(await betaCounters(f), { tickets: 2, mutations: 2, upload_attempts: 0 });
  });
});
