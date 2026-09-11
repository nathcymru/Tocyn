import assert from 'node:assert/strict';
import test from 'node:test';
import { withTwoTenantFixture, type FixtureResponse, type LocalTenantFixture } from './local-tenant-fixture';
import { renderMutationSnapshotV1 } from '../src/services/ticket-mutation-replay.service';

async function expectStatus(response: FixtureResponse, expected: number, reason: string): Promise<void> {
  if (response.status === expected) return;
  await response.body?.cancel();
  assert.fail(`${reason}: received ${response.status}`);
}

async function operatorToken(fixture: LocalTenantFixture): Promise<string> {
  const challenge = await (await fixture.login('operatorA')).json<{ token?: string; mfa_required?: boolean }>();
  assert.equal(challenge.mfa_required, true);
  assert.equal(typeof challenge.token, 'string');
  const verified = await fixture.request('/api/auth/mfa/verify', {
    method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode('operatorA') },
  });
  await expectStatus(verified, 200, 'MFA session must be current');
  const body = await verified.json<{ token?: string }>();
  assert.ok(body.token);
  return body.token!;
}

test('pre-format replay snapshots remain byte-contract compatible', () => {
  const raw = JSON.stringify({
    version: 1,
    ticket: { id: 'legacy-ticket', subject: 'Legacy', status: 'open', priority: 'normal', customer_email: 'customer@example.test', source: 'api', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    article: { id: 'legacy-article', ticket_id: 'legacy-ticket', sender_type: 'customer', body: '**literal legacy**', is_internal: 0, created_at: '2026-01-01T00:00:00.000Z', intake_source: 'api' },
    attachments: [],
  });
  const replay = renderMutationSnapshotV1(raw, 'api.ticket.reply', true, true);
  assert.equal(replay.body.body, '**literal legacy**');
  assert.equal(Object.hasOwn(replay.body, 'body_format'), false, 'Old response snapshots remain frozen rather than gaining a new response field');
});

test('versioned dashboard articles and drafts remain tenant/session scoped in the local D1 runtime', async () => {
  await withTwoTenantFixture(async fixture => {
    const operatorA = await operatorToken(fixture);
    const newDraft = await fixture.request('/api/workspace/drafts/fixture-ticket', {
      method: 'PUT', token: operatorA,
      body: { expectedGeneration: null, expectedRevision: 0, mode: 'public', body: '**draft**', bodyFormat: 'markdown-v1', attachments: [] },
    });
    await expectStatus(newDraft, 200, 'An authenticated tenant operator may save markdown-v1 work');
    const draft = await newDraft.json<{ bodyFormat: string; generation: string; revision: number }>();
    assert.equal(draft.bodyFormat, 'markdown-v1');

    await expectStatus(await fixture.request('/api/workspace/drafts/fixture-ticket', {
      method: 'PUT', token: operatorA,
      body: { expectedGeneration: draft.generation, expectedRevision: draft.revision, mode: 'public', body: 'bad', bodyFormat: 'markdown-v2', attachments: [] },
    }), 400, 'Unknown draft formats must be rejected before a CAS write');

    await fixture.db.prepare(`INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES (?,?,?,?,?)`)
      .bind(fixture.principals.operatorA.tenantId, 'legacy-draft-ticket', 'Legacy draft', fixture.principals.customerA.email, 'dashboard').run();
    await fixture.db.prepare(`INSERT INTO operator_drafts
      (tenant_id,user_id,ticket_id,generation,revision,mode,body,attachments,base_conversation_revision)
      VALUES (?,?,?,?,1,'internal','literal **legacy**','[]',0)`)
      .bind(fixture.principals.operatorA.tenantId, fixture.principals.operatorA.localId, 'legacy-draft-ticket', '123e4567-e89b-12d3-a456-426614174000').run();
    const legacy = await fixture.request('/api/workspace/drafts/legacy-draft-ticket', { token: operatorA });
    await expectStatus(legacy, 200, 'Historic draft bytes must remain available');
    assert.equal((await legacy.json<{ body: string; bodyFormat: string }>()).bodyFormat, 'plain');

    const response = await fixture.request('/api/tickets/fixture-ticket/articles', {
      method: 'POST', token: operatorA,
      body: { body: '# Public heading\n\n**safe**', body_format: 'markdown-v1', is_internal: false, attachments: [] },
    });
    await expectStatus(response, 201, 'An authenticated operator may create a markdown-v1 public article');
    const article = await response.json<{ id: string; body_format: string }>();
    assert.equal(article.body_format, 'markdown-v1');
    const stored = await fixture.db.prepare('SELECT body,body_format FROM articles WHERE tenant_id=? AND id=?')
      .bind(fixture.principals.operatorA.tenantId, article.id).first<{ body: string; body_format: string }>();
    assert.deepEqual(stored, { body: '# Public heading\n\n**safe**', body_format: 'markdown-v1' });
    const captured = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to: string; text: string }>>();
    const mail = captured.find(message => message.to === fixture.principals.customerA.email);
    assert.equal(mail?.text, 'Public heading\n\nsafe', 'The local-only transport receives the readable Markdown text alternative');

    await expectStatus(await fixture.request('/api/tickets/fixture-ticket/articles', {
      method: 'POST', token: operatorA,
      body: { body: 'bad format', body_format: 'markdown-v2', is_internal: false, attachments: [] },
    }), 400, 'Unknown article formats must not create an article or email attempt');
  });
});
