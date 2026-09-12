import assert from 'node:assert/strict';
import test from 'node:test';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { CapabilityPolicyService } from '../src/repositories/capability-policy.repository';
import { LocalBetaAdmissionRepository } from '../src/repositories/local-beta-admission.repository';
import { SlaClockRepository } from '../src/repositories/sla-clock.repository';
import { SupportStateRepository } from '../src/repositories/support-state.repository';
import { betaCounters, initializeLocalBetaFixture } from './local-beta-fixture';
import { withTwoTenantFixture, type LocalTenantFixture } from './local-tenant-fixture';

async function operatorToken(fixture: LocalTenantFixture, operator: 'operatorA' | 'operatorB'): Promise<string> {
  const challenge = await (await fixture.login(operator)).json<{ token: string }>();
  const verified = await fixture.request('/api/auth/mfa/verify', {
    method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(operator) },
  });
  assert.equal(verified.status, 200);
  return (await verified.json<{ token: string }>()).token;
}

const calendar = {
  timeZone: 'UTC',
  weekly: {
    monday: [{ startMinute: 0, endMinute: 1440 }], tuesday: [{ startMinute: 0, endMinute: 1440 }],
    wednesday: [{ startMinute: 0, endMinute: 1440 }], thursday: [{ startMinute: 0, endMinute: 1440 }],
    friday: [{ startMinute: 0, endMinute: 1440 }], saturday: [{ startMinute: 0, endMinute: 1440 }],
    sunday: [{ startMinute: 0, endMinute: 1440 }],
  },
  exceptions: [], dst: { ambiguousLocalTime: 'earlier' as const, nonexistentLocalTime: 'next-valid' as const },
};

test('guarded local beta admits SLA policy and one-ticket recovery atomically', async () => {
  await withTwoTenantFixture(async fixture => {
    const operatorA = await operatorToken(fixture, 'operatorA');
    const operatorB = await operatorToken(fixture, 'operatorB');
    await initializeLocalBetaFixture(fixture, {
      runId: 'sla-local-beta-admission',
      tenants: [fixture.principals.customerA.tenantId, fixture.principals.customerB.tenantId],
      invitations: Object.values(fixture.principals).map(principal => ({
        tenantId: principal.tenantId, id: principal.localId, kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const,
      })),
      limits: { ticketLimit: 2, mutationLimit: 3, recoveryReserve: 1, uploadLimit: 1 },
    });
    await fixture.enableCombinedTicketAdmission();

    assert.equal((await fixture.request('/api/sla-policy', { token: operatorA })).status, 200);
    for (const [method, path] of [
      ['POST', '/api/sla-policy'], ['GET', '/api/sla-policy/extra'], ['POST', '/api/tickets/fixture-ticket/sla/initialize/extra'],
      ['POST', '/api/v1/tickets/fixture-ticket/sla/initialize'], ['POST', '/api/tickets/sla/initialize/bulk'],
    ] as const) {
      const response = await fixture.request(path, { method, token: operatorA, body: method === 'POST' ? {} : undefined });
      assert.equal(response.status, 503, `${method} ${path}`);
      assert.equal((await response.json<{ code: string }>()).code, 'feature_disabled');
    }

    const policyInput = { expectedRevision: 0, calendar, responseTargetMs: 60_000, resolutionTargetMs: null };
    const policy = await fixture.request('/api/sla-policy', { method: 'PUT', token: operatorA, body: policyInput, idempotencyKey: 'policy-first' });
    assert.equal(policy.status, 200);
    assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 1, upload_attempts: 0 });
    assert.equal((await fixture.db.prepare("SELECT count(*) AS n FROM sla_policies WHERE tenant_id='fixture-tenant-b'").first<{ n: number }>())?.n, 0);

    const policyReplay = await fixture.request('/api/sla-policy', { method: 'PUT', token: operatorA, body: policyInput, idempotencyKey: 'policy-first' });
    assert.equal(policyReplay.status, 200);
    assert.equal(policyReplay.headers.get('Idempotency-Replayed'), 'true');
    const stale = await fixture.request('/api/sla-policy', { method: 'PUT', token: operatorA, body: policyInput, idempotencyKey: 'policy-stale' });
    assert.equal(stale.status, 409);
    assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 1, upload_attempts: 0 });

    const initialized = await fixture.request('/api/tickets/fixture-ticket/sla/initialize', { method: 'POST', token: operatorA, body: {}, idempotencyKey: 'initialize-first' });
    assert.equal(initialized.status, 201);
    assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 2, upload_attempts: 0 });
    const initializationReplay = await fixture.request('/api/tickets/fixture-ticket/sla/initialize', { method: 'POST', token: operatorA, body: {}, idempotencyKey: 'initialize-first' });
    assert.equal(initializationReplay.status, 201);
    assert.equal(initializationReplay.headers.get('Idempotency-Replayed'), 'true');
    const alreadyInitialized = await fixture.request('/api/tickets/fixture-ticket/sla/initialize', { method: 'POST', token: operatorA, body: {}, idempotencyKey: 'initialize-existing' });
    assert.equal(alreadyInitialized.status, 200);
    assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 2, upload_attempts: 0 });

    const foreign = await fixture.request('/api/tickets/fixture-b-only/sla/initialize', { method: 'POST', token: operatorA, body: {}, idempotencyKey: 'foreign-ticket' });
    assert.ok(foreign.status === 403 || foreign.status === 404, 'a foreign ticket is denied');
    assert.equal((await fixture.request('/api/tickets/fixture-b-only/sla', { token: operatorB })).status, 404, 'tenant B is unchanged by tenant A');
    assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 2, upload_attempts: 0 });

    await fixture.db.prepare("UPDATE local_beta_policy SET state='intake_stopped',revision=revision+1 WHERE singleton=1").run();
    const stoppedPolicy = await fixture.request('/api/sla-policy', { method: 'PUT', token: operatorA,
      body: { ...policyInput, expectedRevision: 1, responseTargetMs: 120_000 }, idempotencyKey: 'policy-stopped' });
    assert.equal(stoppedPolicy.status, 503);
    assert.equal((await stoppedPolicy.json<{ code: string }>()).code, 'beta_intake_stopped');

    await fixture.db.batch([
      fixture.db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,customer_id,customer_email,source) VALUES ('fixture-tenant-a','recovery-ticket','Recovery','open','fixture-customer','customer-a@example.invalid','fixture')"),
      fixture.db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,customer_id,customer_email,source) VALUES ('fixture-tenant-a','stopped-ticket','Stopped','open','fixture-customer','customer-a@example.invalid','fixture')"),
    ]);
    const recovery = await fixture.request('/api/tickets/recovery-ticket/sla/initialize', { method: 'POST', token: operatorA, body: {}, idempotencyKey: 'recovery-ticket' });
    assert.equal(recovery.status, 201, 'reserved conversation capacity repairs one clock after intake stops');
    assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 3, upload_attempts: 0 });

    await fixture.db.prepare("UPDATE local_beta_policy SET state='writes_stopped',revision=revision+1 WHERE singleton=1").run();
    const stoppedRecovery = await fixture.request('/api/tickets/stopped-ticket/sla/initialize', { method: 'POST', token: operatorA, body: {}, idempotencyKey: 'stopped-ticket' });
    assert.equal(stoppedRecovery.status, 503);
    assert.equal((await stoppedRecovery.json<{ code: string }>()).code, 'beta_intake_stopped');
    assert.equal((await fixture.db.prepare("SELECT count(*) AS n FROM ticket_sla_clocks WHERE tenant_id='fixture-tenant-a' AND ticket_id='stopped-ticket'").first<{ n: number }>())?.n, 0);

    await fixture.db.prepare("UPDATE local_beta_policy SET state='running',revision=revision+1 WHERE singleton=1").run();
    const beforeExhaustion = await fixture.db.prepare("SELECT count(*) AS n FROM support_sla_mutation_receipts WHERE tenant_id='fixture-tenant-a'").first<{ n: number }>();
    const exhausted = await fixture.request('/api/sla-policy', { method: 'PUT', token: operatorA,
      body: { ...policyInput, expectedRevision: 1, responseTargetMs: 120_000 }, idempotencyKey: 'policy-exhausted' });
    assert.equal(exhausted.status, 429);
    assert.equal((await exhausted.json<{ code: string }>()).code, 'beta_mutation_limit');
    assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 3, upload_attempts: 0 });
    assert.equal((await fixture.db.prepare("SELECT revision FROM sla_policies WHERE tenant_id='fixture-tenant-a'").first<{ revision: number }>())?.revision, 1);
    assert.deepEqual(await fixture.db.prepare("SELECT count(*) AS n FROM support_sla_mutation_receipts WHERE tenant_id='fixture-tenant-a'").first<{ n: number }>(), beforeExhaustion,
      'a rejected local-beta batch leaves no SLA receipt');

    await fixture.revokePrincipalSessions('operatorA');
    const revoked = await fixture.request('/api/sla-policy', { token: operatorA });
    assert.equal(revoked.status, 401);
    assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 3, upload_attempts: 0 });
  });
});

test('guarded local beta returns direct SLA policy and clock business outcomes without combined admission', async () => {
  await withTwoTenantFixture(async fixture => {
    const operatorA = await operatorToken(fixture, 'operatorA');
    await initializeLocalBetaFixture(fixture, {
      runId: 'sla-local-beta-direct',
      tenants: [fixture.principals.customerA.tenantId, fixture.principals.customerB.tenantId],
      invitations: Object.values(fixture.principals).map(principal => ({
        tenantId: principal.tenantId, id: principal.localId, kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const,
      })),
      limits: { ticketLimit: 2, mutationLimit: 3, recoveryReserve: 1, uploadLimit: 1 },
    });

    const policy = await fixture.request('/api/sla-policy', { method: 'PUT', token: operatorA, idempotencyKey: 'direct-policy',
      body: { expectedRevision: 0, calendar, responseTargetMs: 60_000, resolutionTargetMs: null } });
    assert.equal(policy.status, 200);
    assert.equal((await policy.json<{ responseTargetMs: number }>()).responseTargetMs, 60_000,
      'the direct route reads the policy write result after local-beta statements');

    const initialized = await fixture.request('/api/tickets/fixture-ticket/sla/initialize', { method: 'POST', token: operatorA,
      body: {}, idempotencyKey: 'direct-initialize' });
    assert.equal(initialized.status, 201);
    assert.deepEqual(await initialized.json(), { initialized: true },
      'the direct route reads the clock insert result after local-beta statements');
    assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 2, upload_attempts: 0 });
  });
});

test('direct local-beta clock initialization rejects a general capability revoked at commit without charging capacity', async () => {
  await withTwoTenantFixture(async fixture => {
    await initializeLocalBetaFixture(fixture, {
      runId: 'sla-local-beta-direct-revoked',
      tenants: [fixture.principals.customerA.tenantId, fixture.principals.customerB.tenantId],
      invitations: Object.values(fixture.principals).map(principal => ({
        tenantId: principal.tenantId, id: principal.localId, kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const,
      })),
      limits: { ticketLimit: 2, mutationLimit: 3, recoveryReserve: 1, uploadLimit: 1 },
    });
    const tenantId = fixture.principals.operatorA.tenantId;
    const actorId = fixture.principals.operatorA.localId;
    const user = await fixture.db.prepare('SELECT session_version FROM users WHERE tenant_id=? AND id=?').bind(tenantId, actorId).first<{ session_version: number }>();
    assert.ok(user);
    const scope = createVerifiedTenantScope(tenantId, actorId, ['admin'], user.session_version);
    const decision = await new CapabilityPolicyService(fixture.db, scope).authorize({ tenantId, actorId, role: 'admin', sessionVersion: user.session_version }, 'general');
    assert.equal(decision.allowed, true);
    const capability = { tenantId, actorId, role: 'admin' as const, sessionVersion: user.session_version,
      capability: decision.capability, policyFingerprint: decision.policyFingerprint };
    const ticketFence = await new SupportStateRepository(fixture.db, scope).captureTicketWriteFence(user.session_version);
    let revoked = false;
    const commitDatabase = new Proxy(fixture.db, { get(target, property, receiver) {
      if (property === 'batch') return async (statements: Parameters<D1Database['batch']>[0]) => {
        if (!revoked) {
          revoked = true;
          await target.prepare("UPDATE deployment_capability_ceiling SET enabled=0,revision=revision+1 WHERE capability='settings.general.manage'").run();
        }
        return target.batch(statements);
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as D1Database;
    const admission = new LocalBetaAdmissionRepository(commitDatabase, scope, { kind: 'staff', id: actorId },
      { sessionVersion: user.session_version, expiresAt: Math.floor(Date.now() / 1_000) + 60 });
    const clocks = new SlaClockRepository(commitDatabase, scope, admission);

    await assert.rejects(() => clocks.initializeExistingTicket('fixture-ticket', ticketFence, capability), { name: 'CapabilityFenceError' });
    assert.equal(revoked, true);
    assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM ticket_sla_clocks WHERE tenant_id=? AND ticket_id=?').bind(tenantId, 'fixture-ticket').first<{ n: number }>())?.n, 0);
    assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 0, upload_attempts: 0 });
  });
});

test('guarded local beta denies unqualified SLA callers and leaves SLA and capacity unchanged', async () => {
  await withTwoTenantFixture(async fixture => {
    const agent = await fixture.createAgentSession('fixture-tenant-a');
    const operatorA = await operatorToken(fixture, 'operatorA');
    const customer = await fixture.login('customerA');
    assert.equal(customer.status, 200);
    const customerToken = (await customer.json<{ token: string }>()).token;
    const apiKey = await fixture.createScopedApiKey('operatorA', ['tickets:read']);
    await initializeLocalBetaFixture(fixture, {
      runId: 'sla-local-beta-denials',
      tenants: [fixture.principals.customerA.tenantId, fixture.principals.customerB.tenantId],
      invitations: [
        ...Object.values(fixture.principals).map(principal => ({
          tenantId: principal.tenantId, id: principal.localId, kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const,
        })),
        { tenantId: 'fixture-tenant-a', id: agent.id, kind: 'staff' as const },
      ],
      limits: { ticketLimit: 2, mutationLimit: 3, recoveryReserve: 1, uploadLimit: 1 },
    });
    const policyInput = { expectedRevision: 0, calendar, responseTargetMs: 60_000, resolutionTargetMs: null };
    const unchanged = async () => {
      assert.equal((await fixture.db.prepare("SELECT count(*) AS n FROM sla_policies WHERE tenant_id='fixture-tenant-a'").first<{ n: number }>())?.n, 0);
      assert.equal((await fixture.db.prepare("SELECT count(*) AS n FROM ticket_sla_clocks WHERE tenant_id='fixture-tenant-a'").first<{ n: number }>())?.n, 0);
      assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 0, upload_attempts: 0 });
    };

    for (const [path, options] of [
      ['/api/sla-policy', { token: customerToken }],
      ['/api/sla-policy', { apiKey: apiKey.apiKey }],
      ['/api/sla-policy', { method: 'PUT', token: customerToken, body: policyInput }],
      ['/api/sla-policy', { method: 'PUT', apiKey: apiKey.apiKey, body: policyInput }],
      ['/api/tickets/fixture-ticket/sla/initialize', { method: 'POST', token: customerToken, body: {} }],
      ['/api/tickets/fixture-ticket/sla/initialize', { method: 'POST', apiKey: apiKey.apiKey, body: {} }],
      ['/api/sla-policy', { method: 'PUT', token: agent.token, body: policyInput }],
      ['/api/tickets/fixture-ticket/sla/initialize', { method: 'POST', token: agent.token, body: {} }],
    ] as const) {
      const response = await fixture.request(path, options);
      assert.ok(response.status === 401 || response.status === 403, `${options.method ?? 'GET'} ${path} is denied`);
      await unchanged();
    }

    await fixture.db.prepare("UPDATE deployment_capability_ceiling SET enabled=0,revision=revision+1 WHERE capability='settings.general.manage'").run();
    for (const [path, options] of [
      ['/api/sla-policy', { method: 'PUT', token: operatorA, body: policyInput }],
      ['/api/tickets/fixture-ticket/sla/initialize', { method: 'POST', token: operatorA, body: {} }],
    ] as const) {
      const response = await fixture.request(path, options);
      assert.equal(response.status, 403, `${options.method} ${path} denies the removed general capability`);
      await unchanged();
    }

    await fixture.db.prepare("UPDATE deployment_capability_ceiling SET enabled=1,revision=revision+1 WHERE capability='settings.general.manage'").run();
    const missing = await fixture.request('/api/tickets/missing-ticket/sla/initialize', { method: 'POST', token: operatorA, body: {} });
    assert.equal(missing.status, 404);
    await unchanged();
  });
});
