import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as OTPAuth from 'otpauth';
import * as jose from 'jose';
import { Headers as MiniflareHeaders, Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { RESOURCE_DIMENSIONS, STOCK_DIMENSIONS, calculatePriorityScore,
  type PriorityCategory, type PriorityScope, type ContractTier, type CriticalityTier } from '@luminatick/shared';
import { createLocalRuntime } from '../src/local-app';
import type { Env } from '../src/bindings';
import { createSystemTenantScope } from '../src/auth/scope';
import { createRepositories } from '../src/repositories';
import { AuthService } from '../src/services/auth/auth.service';
import { MFAService } from '../src/services/auth/mfa.service';
import { DEFAULT_SLA_CALENDAR } from '../src/domain/sla-clock';
import { splitSql } from './split-sql';

const serverRoot = resolve(import.meta.dirname, '..');
const migrationsDirectory = join(serverRoot, 'migrations');
const fixtureMarker = 'tocyn-local-fixture';
let fixtureRun = 0;
const principalNames = ['customerA', 'operatorA', 'customerB', 'operatorB'] as const;
const fixtureWidgetKeys: Record<Tenant, string> = {
  'fixture-tenant-a': 'fixture-widget-key-a',
  'fixture-tenant-b': 'fixture-widget-key-b',
};

type PrincipalName = typeof principalNames[number];
type Tenant = 'fixture-tenant-a' | 'fixture-tenant-b';
type Role = 'customer' | 'admin';
type OperatorPrincipal = 'operatorA' | 'operatorB';
type TicketPermission = 'tickets:read' | 'tickets:write';

type R2OperationCounts = Readonly<{
  get: number;
  put: number;
  delete: number;
  list: number;
}>;

type PrivatePrincipal = {
  tenantId: Tenant;
  localId: 'fixture-customer' | 'fixture-operator';
  role: Role;
  email: string;
  password: string;
  mfaSecret?: string;
};

export type FixturePrincipal = Readonly<{
  name: PrincipalName;
  tenantId: Tenant;
  localId: 'fixture-customer' | 'fixture-operator';
  role: Role;
  email: string;
  widgetKey: string;
  portalLoginUrl: string;
}>;

export type FixtureResponse = Response & {
  json: <T = unknown>() => Promise<T>;
};

/** Local-only binding shared with route composition; unavailable outside a fixture callback. */
export type FixtureR2 = Readonly<{
  bucket: R2Bucket;
  operationCounts: () => R2OperationCounts;
  /** Synthetic R2 failure; uncertain mode stores the object before reporting failure. */
  failNextPut: (uncertain?: boolean) => void;
  /** Pause one actual marker read to exercise upload admission ordering. */
  pauseNextGet: () => Readonly<{ started: Promise<void>; release: () => void }>;
}>;

export type LocalTenantFixture = Readonly<{
  principals: Readonly<Record<PrincipalName, FixturePrincipal>>;
  /** Enable guarded requests only after explicit local operator policy setup; no automatic invitations. */
  enableLocalBeta: () => void;
  /** Enables only the existing synthetic isolated-evidence gate for this disposable fixture. */
  enableIsolatedObservability: () => void;
  /**
   * Enables the existing combined ticket-admission policy only for a configured
   * guarded local-beta fixture. Its authority and Durable Objects stay local.
   */
  enableCombinedTicketAdmission: () => Promise<void>;
  /** Enables the real admission authority in API-only mode for capability-negation checks. */
  enableApiTicketAdmission: () => Promise<void>;
  restartLocalRuntime: () => void;
  db: D1Database;
  r2: FixtureR2;
  rateLimitIdentity: string;
  request: (path: string, options?: {
    method?: string;
    body?: unknown;
    /** Sends bytes as supplied, for bounded malformed/streamed request checks. */
    rawBody?: BodyInit;
    /** Defaults to application/json for a supplied body or raw body. Use null to omit it. */
    contentType?: string | null;
    /** Additional request headers for narrow route-level assertions such as CORS preflight. */
    headers?: Record<string, string>;
    /** Optional case-sensitive retry key mapped to the public Idempotency-Key header. */
    idempotencyKey?: string;
    token?: string;
    apiKey?: string;
    origin?: string;
    ip?: string;
  }) => Promise<FixtureResponse>;
  login: (principal: PrincipalName, password?: string) => Promise<FixtureResponse>;
  currentMfaCode: (principal: 'operatorA' | 'operatorB') => string;
  invalidMfaCode: (principal: 'operatorA' | 'operatorB') => string;
  /** A synthetic, DB-backed agent session for narrow route authorization checks. */
  createAgentSession: (tenantId: Tenant, mfaVerified?: boolean) => Promise<Readonly<{ id: string; token: string }>>;
  createScopedApiKey: (operator: OperatorPrincipal, permissions: readonly TicketPermission[]) => Promise<Readonly<{
    id: string;
    apiKey: string;
    permissions: readonly TicketPermission[];
  }>>;
  revokePrincipalSessions: (principal: PrincipalName) => Promise<void>;
  tokenTenant: (token: string) => Promise<Tenant>;
  widgetTokenTenant: (token: string) => Promise<Tenant>;
  assertStoredCredentialProtection: (rawApiKey: string) => Promise<void>;
  resourceUsage: () => Promise<Readonly<{ d1Rows: number; r2Objects: number; routeRequests: number }>>;
  notificationAttempts: () => number;
  resetNotificationAttempts: () => void;
  /** Fails only the local notification provider; D1/R2 remain real Miniflare bindings. */
  failNotificationAttempts: (count: number) => void;
}>;

export type FixtureReport = Readonly<{
  result: 'passed';
  mode: 'disposable-miniflare';
  tenants: 2;
  principals: 4;
  customerPasswordLogins: 2;
  customerMagicLinkAuthentications: 2;
  operatorMfaLogins: 2;
  apiKeysCreated: 2;
  revokedKeysRejected: true;
  crossTenantMetadataWrites: 0;
  foreignKeyViolations: 0;
  remoteBindings: 0;
  d1Rows: number;
  r2Objects: number;
  routeRequests: number;
  elapsedMs: number;
  cleanup: 'disposed';
}>;

function randomLocalSecret(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

function portalLoginUrl(tenantId: Tenant): string {
  const url = new URL('http://localhost:5174/login');
  url.searchParams.set('key', fixtureWidgetKeys[tenantId]);
  return url.toString();
}

function publicPrincipal(name: PrincipalName, principal: PrivatePrincipal): FixturePrincipal {
  return Object.freeze({
    name, tenantId: principal.tenantId, localId: principal.localId, role: principal.role, email: principal.email,
    widgetKey: fixtureWidgetKeys[principal.tenantId], portalLoginUrl: portalLoginUrl(principal.tenantId),
  });
}

function generatedPrincipals(): Record<PrincipalName, PrivatePrincipal> {
  return {
    customerA: { tenantId: 'fixture-tenant-a', localId: 'fixture-customer', role: 'customer', email: 'tocyn-auth-test-a@example.invalid', password: randomLocalSecret() },
    operatorA: { tenantId: 'fixture-tenant-a', localId: 'fixture-operator', role: 'admin', email: 'fixture.operator.a@example.test', password: randomLocalSecret() },
    customerB: { tenantId: 'fixture-tenant-b', localId: 'fixture-customer', role: 'customer', email: 'tocyn-auth-test-b@example.invalid', password: randomLocalSecret() },
    operatorB: { tenantId: 'fixture-tenant-b', localId: 'fixture-operator', role: 'admin', email: 'fixture.operator.b@example.test', password: randomLocalSecret() },
  };
}

function localEnv(db: D1Database, bucket: R2Bucket): Env {
  return {
    DB: db,
    ATTACHMENTS_BUCKET: bucket,
    NOTIFICATION_DO: {} as DurableObjectNamespace,
    BUDGET_COORDINATOR_DO: {} as DurableObjectNamespace,
    BUDGET_GRANT_HOLDER_DO: {} as DurableObjectNamespace,
    VECTORIZE_WORKFLOW: undefined,
    VECTOR_INDEX: {} as VectorizeIndex,
    AI: undefined,
    RESEND_API_KEY: '',
    RESEND_FROM_EMAIL: '',
    JWT_SECRET: randomLocalSecret(32),
    MFA_ENCRYPTION_KEY: randomLocalSecret(32),
    APP_MASTER_KEY: randomLocalSecret(32),
    ENVIRONMENT: 'local',
    // Explicit server-side policy for this fixture; no route may infer a budget mode.
    BUDGET_ADMISSION_POLICY: 'off',
    PORTAL_URL: 'http://localhost:5174',
    DASHBOARD_URL: 'http://localhost:5173',
    CORS_ORIGINS: 'http://localhost:5174,http://localhost:5173',
  };
}

/** A complete, high-capacity synthetic owner authority for two local fixture tenants.
 * It is intentionally created only by enableCombinedTicketAdmission, after the
 * fixture's local-beta policy and invitations have been installed. */
async function enableTicketAdmission(env: Env, db: D1Database, policy: 'api-ticket-mutations-v1' | 'ticket-mutations-v1'): Promise<void> {
  assert.equal(env.LOCAL_BETA_ENABLED, 'true', 'Combined admission evidence requires the guarded local-beta fixture');
  if (env.BUDGET_ADMISSION_POLICY === 'api-ticket-mutations-v1') {
    assert.equal(policy, 'ticket-mutations-v1', 'The disposable authority supports only an API-to-combined transition');
    env.BUDGET_ADMISSION_POLICY = policy;
    return;
  }
  assert.equal(env.BUDGET_ADMISSION_POLICY, 'off', 'Admission authority may be seeded once per disposable fixture');
  const deploymentId = 'fixture-combined-beta-deployment';
  const policyId = 'fixture-combined-beta-policy';
  const authorityRevision = 1;
  const policyRevision = 1;
  // Keep the disposable authority complete. New admitted paths must not be
  // rejected merely because this local fixture omitted a catalogue dimension.
  // Individual negative tests install their own deliberately constrained policy.
  const dimensions = RESOURCE_DIMENSIONS;
  const limitFor = (dimension: typeof dimensions[number]) => dimension === 'logEvents' ? 200_000_000 : 10_000_000;
  const ownerPolicy = {
    schemaVersion: 1,
    policyId,
    revision: policyRevision,
    deploymentId,
    mode: 'conservative',
    catalogueVersion: 'fixture-combined-beta-catalogue',
    maxGrantLifetimeMs: 60_000,
    budgets: dimensions.map(dimension => ({
      dimension,
      allocationId: `fixture-combined-${dimension}`,
      window: STOCK_DIMENSIONS.includes(dimension)
        ? { kind: 'stock', id: `fixture-combined-${dimension}-stock` }
        : { kind: 'interval', id: 'fixture-combined-window', startsAt: Date.now() - 1_000, endsAt: Date.now() + 60_000 },
      limit: limitFor(dimension),
      recoveryPercent: 20,
      provenance: 'owner-allocation',
    })),
  };
  const restrictions = (tenantId: Tenant) => JSON.stringify({
    schemaVersion: 1, tenantId, ownerPolicyId: policyId, ownerPolicyRevision: policyRevision,
    revision: 1, mode: 'conservative', limits: Object.fromEntries(dimensions.map(dimension => [dimension, limitFor(dimension)])), disabledFeatures: [],
  });
  await db.batch([
    db.prepare(`INSERT INTO budget_deployment_authority (deployment_id,authority_revision,state,updated_at)
      VALUES (?,?,'active',?)`).bind(deploymentId, authorityRevision, Date.now()),
    db.prepare(`INSERT INTO budget_owner_policies
      (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES (?,?,?,?,?,?,?,?)`).bind(deploymentId, policyId, policyRevision, authorityRevision,
      'fixture-combined-beta-coordinator', 64, 60_000, JSON.stringify(ownerPolicy)),
    ...(['fixture-tenant-a', 'fixture-tenant-b'] as const).map((tenantId, index) => db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES (?,?,?,?,?,?,?,'active')`).bind(deploymentId, tenantId, policyId, policyRevision, authorityRevision,
      `fixture-combined-namespace-${index}`, restrictions(tenantId))),
  ]);
  env.BUDGET_ADMISSION_POLICY = policy;
}

async function applyMigrations(db: D1Database): Promise<void> {
  const migrations = readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort();
  for (const migration of migrations) {
    const statements = splitSql(readFileSync(join(migrationsDirectory, migration), 'utf8'));
    await db.batch(statements.map(statement => db.prepare(statement)));
  }
}

function mfaCode(secret: string): string {
  return new OTPAuth.TOTP({
    issuer: 'Luminatick', label: fixtureMarker, algorithm: 'SHA1', digits: 6, period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const beta2MinutesAgo = (now: number, minutes: number) => new Date(now - minutes * 60_000).toISOString();
const beta2ReviewTickets = [
  { id: 'beta2-breach-billing', subject: 'Invoice correction needs a reply', status: 'open', priority: 'urgent', source: 'email', assigned: false, createdMinutesAgo: 720, articleMinutesAgo: 50, body: 'The invoice amount looks incorrect. Please check the line items and let me know the next step.' },
  { id: 'beta2-breach-delivery', subject: 'Delivery update is overdue', status: 'open', priority: 'high', source: 'web', assigned: false, createdMinutesAgo: 660, articleMinutesAgo: 42, body: 'I have not received an update on the delayed parcel. Can someone confirm its status?' },
  { id: 'beta2-billing-urgent', subject: 'Duplicate charge on a synthetic order', status: 'open', priority: 'urgent', source: 'email', assigned: true, createdMinutesAgo: 210, articleMinutesAgo: 125, body: 'I can see the same charge twice. Please help me understand the adjustment.' },
  { id: 'beta2-account-access', subject: 'Cannot open my account settings', status: 'open', priority: 'high', source: 'web', assigned: true, createdMinutesAgo: 190, articleMinutesAgo: 115, body: 'The account settings page asks me to sign in again after I have already signed in.' },
  { id: 'beta2-refund-request', subject: 'Refund status for a returned item', status: 'pending', priority: 'normal', source: 'email', assigned: false, createdMinutesAgo: 185, articleMinutesAgo: 105, body: 'I returned the item last week. Could you confirm when the refund will appear?' },
  { id: 'beta2-portal-upload', subject: 'Document upload did not finish', status: 'open', priority: 'normal', source: 'web', assigned: true, createdMinutesAgo: 175, articleMinutesAgo: 95, body: 'My document upload stopped before completion. I can try again if needed.' },
  { id: 'beta2-widget-question', subject: 'Question from the support widget', status: 'open', priority: 'low', source: 'widget', assigned: false, createdMinutesAgo: 165, articleMinutesAgo: 85, body: 'Where can I find the order reference in my confirmation message?' },
  { id: 'beta2-waiting-customer', subject: 'Waiting for a customer photo', status: 'pending', priority: 'normal', source: 'email', assigned: true, createdMinutesAgo: 160, articleMinutesAgo: 80, body: 'I can send a photo of the packaging once I am home.' },
  { id: 'beta2-waiting-provider', subject: 'Carrier confirmation requested', status: 'pending', priority: 'high', source: 'api', assigned: true, createdMinutesAgo: 155, articleMinutesAgo: 75, body: 'Please confirm whether the carrier has received the replacement parcel.' },
  { id: 'beta2-follow-up', subject: 'Replacement follow-up completed', status: 'resolved', priority: 'normal', source: 'web', assigned: true, createdMinutesAgo: 150, articleMinutesAgo: 70, body: 'The replacement arrived. Thank you for checking in.' },
  { id: 'beta2-closed-confirmed', subject: 'Completed address correction', status: 'closed', priority: 'low', source: 'email', assigned: true, createdMinutesAgo: 145, articleMinutesAgo: 65, body: 'The updated address is correct. This can be closed.' },
  { id: 'beta2-priority-low', subject: 'Product information request', status: 'open', priority: 'low', source: 'web', assigned: false, createdMinutesAgo: 140, articleMinutesAgo: 55, body: 'I would like to know which accessories are included.' },
  { id: 'beta2-security-question', subject: 'Account security question', status: 'open', priority: 'high', source: 'email', assigned: true, createdMinutesAgo: 2640, articleMinutesAgo: 45, body: 'I received a security notice and would like help understanding it.' },
  { id: 'beta2-api-update', subject: 'API status update request', status: 'open', priority: 'normal', source: 'api', assigned: false, createdMinutesAgo: 1800, articleMinutesAgo: 35, body: 'Could you confirm the status of my integration request?' },
] as const;
type Beta2ReviewTicketId = typeof beta2ReviewTickets[number]['id']
  | 'beta2-open-assigned' | 'beta2-pending-unassigned' | 'beta2-snoozed-assigned'
  | 'beta2-resolved' | 'beta2-email' | 'beta2-internal-attachment';
type ReviewUrgencyCondition = 'regulatoryOfficerOnSite' | 'vipBlocked' | 'hardDeadline';
type ReviewPrioritySeed = Readonly<{ category: PriorityCategory; scope: PriorityScope;
  contractTier: ContractTier; criticalityTier: CriticalityTier; urgency: readonly ReviewUrgencyCondition[] }>;

/** Explicit 16 tier×level pairs plus four repeats for overdue, drift and email review. */
export const beta2ReviewPrioritySeeds = {
  'beta2-breach-billing': { category: 'transactions-billing', scope: 'localised', contractTier: 'alpha', criticalityTier: 4, urgency: ['regulatoryOfficerOnSite', 'hardDeadline'] },
  'beta2-breach-delivery': { category: 'incidents-interruptions', scope: 'localised', contractTier: 'alpha', criticalityTier: 4, urgency: ['hardDeadline'] },
  'beta2-billing-urgent': { category: 'transactions-billing', scope: 'localised', contractTier: 'alpha', criticalityTier: 3, urgency: ['vipBlocked', 'hardDeadline'] },
  'beta2-account-access': { category: 'access-authentication', scope: 'systemic', contractTier: 'alpha', criticalityTier: 2, urgency: ['vipBlocked'] },
  'beta2-refund-request': { category: 'transactions-billing', scope: 'isolated', contractTier: 'alpha', criticalityTier: 1, urgency: [] },
  'beta2-portal-upload': { category: 'technical-problems', scope: 'localised', contractTier: 'bravo', criticalityTier: 4, urgency: [] },
  'beta2-widget-question': { category: 'how-to-assistance', scope: 'isolated', contractTier: 'bravo', criticalityTier: 3, urgency: [] },
  'beta2-waiting-customer': { category: 'service-requests', scope: 'isolated', contractTier: 'bravo', criticalityTier: 2, urgency: [] },
  'beta2-waiting-provider': { category: 'status-follow-up', scope: 'localised', contractTier: 'bravo', criticalityTier: 1, urgency: [] },
  'beta2-follow-up': { category: 'status-follow-up', scope: 'isolated', contractTier: 'charlie', criticalityTier: 4, urgency: [] },
  'beta2-closed-confirmed': { category: 'feedback', scope: 'isolated', contractTier: 'charlie', criticalityTier: 3, urgency: [] },
  'beta2-priority-low': { category: 'information-requests', scope: 'isolated', contractTier: 'charlie', criticalityTier: 2, urgency: [] },
  'beta2-pending-unassigned': { category: 'service-requests', scope: 'isolated', contractTier: 'charlie', criticalityTier: 1, urgency: [] },
  'beta2-open-assigned': { category: 'service-requests', scope: 'isolated', contractTier: 'delta', criticalityTier: 1, urgency: [] },
  'beta2-internal-attachment': { category: 'service-requests', scope: 'localised', contractTier: 'delta', criticalityTier: 2, urgency: [] },
  'beta2-snoozed-assigned': { category: 'status-follow-up', scope: 'isolated', contractTier: 'delta', criticalityTier: 3, urgency: [] },
  'beta2-resolved': { category: 'other', scope: 'isolated', contractTier: 'delta', criticalityTier: 4, urgency: [] },
  'beta2-email': { category: 'transactions-billing', scope: 'isolated', contractTier: 'bravo', criticalityTier: 3, urgency: [] },
  'beta2-security-question': { category: 'security-privacy', scope: 'systemic', contractTier: 'delta', criticalityTier: 1, urgency: ['regulatoryOfficerOnSite'] },
  'beta2-api-update': { category: 'technical-problems', scope: 'localised', contractTier: 'delta', criticalityTier: 1, urgency: [] },
} as const satisfies Record<Beta2ReviewTicketId, ReviewPrioritySeed>;

const beta2TenantBPrioritySeeds = {
  'beta2-b-open-unassigned': { category: 'service-requests', scope: 'isolated', contractTier: 'charlie', criticalityTier: 2, urgency: [] },
  'beta2-b-email': { category: 'transactions-billing', scope: 'isolated', contractTier: 'delta', criticalityTier: 1, urgency: [] },
} as const satisfies Record<'beta2-b-open-unassigned' | 'beta2-b-email', ReviewPrioritySeed>;

const beta2ReviewRequesterNames = [
  'alex.morgan', 'samira.patel', 'jordan.ellis', 'priya.shah',
  'taylor.reed', 'mika.chen', 'avery.hughes', 'noor.khan',
  'robin.carter', 'jamie.clarke', 'imani.brooks', 'casey.ward',
  'leila.hassan', 'devon.price',
] as const;
const beta2ReviewTicket = (ticketId: string) => beta2ReviewTickets.find(ticket => ticket.id === ticketId);
const beta2TicketAgeMinutes = (ticketId: string) => beta2ReviewTicket(ticketId)?.createdMinutesAgo ?? (ticketId === 'beta2-email' ? 600 : 240);
const beta2ArticleAgeMinutes = (ticketId: string) => beta2ReviewTicket(ticketId)?.articleMinutesAgo ?? (ticketId === 'beta2-email' ? 540 : ticketId === 'beta2-resolved' ? 120 : 180);
const beta2ReviewUpdatedAgeMinutes = (ticketId: string) => beta2ArticleAgeMinutes(ticketId) - (['beta2-billing-urgent', 'beta2-account-access', 'beta2-follow-up', 'beta2-closed-confirmed'].includes(ticketId) ? 10 : 0);

/** Add 14 review conversations through one SQL source used by both local seeding paths. */
function appendBeta2ReviewFixtureSql(rows: string[], now: number): void {
  assert.equal(beta2ReviewRequesterNames.length, beta2ReviewTickets.length, 'Every review conversation needs a synthetic requester');
  const literal = (value: string | number | null) => value === null ? 'NULL' : sqlLiteral(String(value));
  for (const [index, ticket] of beta2ReviewTickets.entries()) {
    const tenantId = 'fixture-tenant-a';
    const customerEmail = `${beta2ReviewRequesterNames[index]}@synthetic.example.test`;
    const assignedTo = ticket.assigned ? 'fixture-operator' : null;
    const sourceEmail = ticket.source === 'email' ? 'support@synthetic.example.test' : null;
    rows.push(`INSERT INTO tickets (tenant_id,id,ticket_no,subject,status,priority,customer_email,assigned_to,source,source_email,created_at,updated_at) VALUES (${[
      tenantId, ticket.id, 207 + index, ticket.subject, ticket.status, ticket.priority, customerEmail, assignedTo, ticket.source, sourceEmail,
      beta2MinutesAgo(now, ticket.createdMinutesAgo), beta2MinutesAgo(now, beta2ReviewUpdatedAgeMinutes(ticket.id)),
    ].map(literal).join(',')});`);
    const articleId = `beta2-article-${ticket.id}`;
    rows.push(`INSERT INTO articles (tenant_id,id,ticket_id,sender_type,body,snippet,body_format,is_internal,intake_source,raw_email_id,created_at) VALUES (${[
      tenantId, articleId, ticket.id, 'customer', ticket.body, ticket.body.substring(0, 250), 'plain', 0,
      ticket.source, ticket.source === 'email' ? `${ticket.id}-raw` : null, beta2MinutesAgo(now, ticket.articleMinutesAgo),
    ].map(literal).join(',')});`);
  }
  const followups = [
    ['beta2-billing-urgent', 'agent', 'I have opened a billing review and will share the result here.', 0],
    ['beta2-billing-urgent', 'agent', 'Private note: check the duplicate charge before the next customer update.', 1],
    ['beta2-account-access', 'agent', 'Please try the account link in a new tab and tell us if the loop continues.', 0],
    ['beta2-follow-up', 'agent', 'I am glad the replacement arrived. This request is now resolved.', 0],
    ['beta2-closed-confirmed', 'agent', 'The address correction is complete and this request is closed.', 0],
  ] as const;
  for (const [index, [ticketId, senderType, body, isInternal]] of followups.entries()) {
    const minutesAgo = beta2ReviewUpdatedAgeMinutes(ticketId) + (ticketId === 'beta2-billing-urgent' && isInternal === 0 ? 5 : 0);
    rows.push(`INSERT INTO articles (tenant_id,id,ticket_id,sender_id,sender_type,body,snippet,body_format,is_internal,intake_source,created_at) VALUES (${[
      'fixture-tenant-a', `beta2-followup-${index + 1}`, ticketId, 'fixture-operator', senderType, body, body.substring(0, 250), 'plain', isInternal, 'dashboard', beta2MinutesAgo(now, minutesAgo),
    ].map(literal).join(',')});`);
  }
  rows.push(`INSERT INTO support_state_definitions (tenant_id,id,legacy_status,internal_label,public_label,waiting_reason_required,next_action_required,is_compatibility_default)
    VALUES ('fixture-tenant-a','beta2-awaiting-customer','pending','Waiting on customer','We need your reply',1,1,0);`);
  rows.push(`UPDATE ticket_support_state SET definition_id='beta2-awaiting-customer',waiting_reason='Waiting for a packaging photo',next_action='Review the photo when the customer replies',changed_at=${literal(beta2MinutesAgo(now, 70))}
    WHERE tenant_id='fixture-tenant-a' AND ticket_id='beta2-waiting-customer';`);
}

/** Synthetic policy and clock snapshots for visual review only. No production policy is inferred. */
function appendBeta2SlaFixtureSql(rows: string[], now: number): void {
  const literal = (value: string | number | null) => value === null ? 'NULL' : sqlLiteral(String(value));
  const calendar = JSON.stringify(DEFAULT_SLA_CALENDAR);
  const responseTargetMs = 6 * 60 * 60_000;
  const resolutionTargetMs = 24 * 60 * 60_000;
  for (const tenantId of Object.keys(fixtureWidgetKeys) as Tenant[]) {
    rows.push(`INSERT INTO sla_policies (tenant_id,revision,response_target_ms,resolution_target_ms,calendar_json,response_reopen_policy,resolution_reopen_policy) VALUES (${[
      tenantId, 1, responseTargetMs, resolutionTargetMs, calendar, 'continue', 'continue',
    ].map(literal).join(',')});`);
  }
  const clocks = [
    ['fixture-tenant-a', 'beta2-open-assigned', null, null],
    ['fixture-tenant-a', 'beta2-pending-unassigned', null, null],
    ['fixture-tenant-a', 'beta2-snoozed-assigned', null, null],
    ['fixture-tenant-a', 'beta2-resolved', beta2MinutesAgo(now, 120), beta2MinutesAgo(now, 120)],
    ['fixture-tenant-a', 'beta2-email', null, null],
    ['fixture-tenant-a', 'beta2-internal-attachment', null, null],
    ...beta2ReviewTickets.map(ticket => [
      'fixture-tenant-a', ticket.id,
      ['beta2-billing-urgent', 'beta2-account-access', 'beta2-follow-up', 'beta2-closed-confirmed'].includes(ticket.id)
        ? beta2MinutesAgo(now, beta2ReviewUpdatedAgeMinutes(ticket.id) + (ticket.id === 'beta2-billing-urgent' ? 5 : 0)) : null,
      ticket.status === 'resolved' || ticket.status === 'closed' ? beta2MinutesAgo(now, beta2ReviewUpdatedAgeMinutes(ticket.id)) : null,
    ] as const),
    ['fixture-tenant-b', 'beta2-b-open-unassigned', null, null],
    ['fixture-tenant-b', 'beta2-b-email', null, null],
  ] as const;
  for (const [tenantId, ticketId, responseCompletedAt, resolutionCompletedAt] of clocks) {
    const started = now - beta2TicketAgeMinutes(ticketId) * 60_000;
    // This one ticket predates the synthetic revision-1 target configuration.
    // Its frozen revision-0 snapshot honestly has no SLA target.
    const targetless = ticketId === 'beta2-pending-unassigned';
    rows.push(`INSERT INTO ticket_sla_clocks
      (tenant_id,ticket_id,response_started_at,response_due_at,response_completed_at,resolution_started_at,resolution_due_at,resolution_completed_at,
       policy_revision,policy_calendar_json,policy_response_target_ms,policy_resolution_target_ms,policy_response_reopen_policy,policy_resolution_reopen_policy)
      VALUES (${[
        tenantId, ticketId, new Date(started).toISOString(), targetless ? null : new Date(started + responseTargetMs).toISOString(), responseCompletedAt,
        new Date(started).toISOString(), targetless ? null : new Date(started + resolutionTargetMs).toISOString(), resolutionCompletedAt,
        targetless ? 0 : 1, calendar, targetless ? null : responseTargetMs, targetless ? null : resolutionTargetMs, 'continue', 'continue',
      ].map(literal).join(',')});`);
  }
}

/** The actual --local-beta SQL path and the disposable test path share this matrix. */
function appendBeta2PriorityFixtureSql(rows: string[]): void {
  const literal = (value: string | number) => sqlLiteral(String(value));
  const add = (tenantId: string, ticketId: string, seed: ReviewPrioritySeed) => {
    const regulatory = Number(seed.urgency.includes('regulatoryOfficerOnSite'));
    const vip = Number(seed.urgency.includes('vipBlocked'));
    const deadline = Number(seed.urgency.includes('hardDeadline'));
    assert.equal(new Set(seed.urgency).size, seed.urgency.length, 'Urgency conditions must not repeat');
    const score = calculatePriorityScore(seed.category, seed.scope, 5 * (regulatory + vip + deadline));
    rows.push(`UPDATE tickets SET priority_category=${literal(seed.category)},priority_scope=${literal(seed.scope)},
      priority_regulatory_officer_on_site=${regulatory},priority_vip_blocked=${vip},priority_hard_deadline=${deadline},
      priority_score=${score},contract_sla_tier=${literal(seed.contractTier)},criticality_tier=${seed.criticalityTier}
      WHERE tenant_id=${literal(tenantId)} AND id=${literal(ticketId)};`);
  };
  assert.equal(Object.keys(beta2ReviewPrioritySeeds).length, 20);
  for (const [ticketId, seed] of Object.entries(beta2ReviewPrioritySeeds)) add('fixture-tenant-a', ticketId, seed);
  for (const [ticketId, seed] of Object.entries(beta2TenantBPrioritySeeds)) add('fixture-tenant-b', ticketId, seed);
}

export type LocalFixtureBootstrap = Readonly<{
  sql: string;
  credentials: ReadonlyArray<Readonly<{ email: string; password: string; provisioningUri?: string; portalLoginUrl?: string }>>;
}>;

/**
 * Builds synthetic fixture rows for a run-owned local D1 database. Callers may write
 * the SQL only to a mode-0600 temporary file and must never report its contents.
 */
export async function createLocalFixtureBootstrap(env: Pick<Env, 'MFA_ENCRYPTION_KEY'>): Promise<LocalFixtureBootstrap> {
  const principals = generatedPrincipals();
  const auth = new AuthService();
  const mfa = new MFAService();
  const rows: string[] = [];
  for (const name of principalNames) {
    const principal = principals[name];
    if (principal.role === 'admin') principal.mfaSecret = mfa.generateSecret();
    const passwordHash = await auth.hashPassword(principal.password);
    const encryptedMfaSecret = principal.mfaSecret ? await mfa.encryptSecret(principal.mfaSecret, env.MFA_ENCRYPTION_KEY) : null;
    rows.push(`INSERT INTO users (tenant_id, id, email, full_name, password_hash, role, mfa_secret, mfa_enabled) VALUES (${[
      principal.tenantId, principal.localId, principal.email, `Synthetic ${name}`, passwordHash, principal.role,
      encryptedMfaSecret, principal.mfaSecret ? '1' : '0',
    ].map(value => value === '1' || value === '0' ? value : value === null ? 'NULL' : sqlLiteral(value)).join(', ')});`);
  }
  for (const tenantId of Object.keys(fixtureWidgetKeys) as Tenant[]) {
    rows.push(`INSERT INTO tenant_config (tenant_id, key, value) VALUES (${sqlLiteral(tenantId)}, 'widget.public_key', ${sqlLiteral(fixtureWidgetKeys[tenantId])});`);
    rows.push(`INSERT INTO tenant_config (tenant_id, key, value) VALUES (${sqlLiteral(tenantId)}, 'PORTAL_URL', ${sqlLiteral('http://localhost:5174')});`);
  }
  appendBeta2FixtureSql(rows, principals);
  return Object.freeze({
    sql: rows.join('\n'),
    credentials: Object.freeze(principalNames.map(name => {
      const principal = principals[name];
      return Object.freeze({
        email: principal.email,
        password: principal.password,
        ...(principal.mfaSecret ? { provisioningUri: mfa.getProvisioningUri(principal.email, principal.mfaSecret) } : {}),
        ...(principal.role === 'customer' ? { portalLoginUrl: portalLoginUrl(principal.tenantId) } : {}),
      });
    })),
  });
}

function appendBeta2FixtureSql(rows: string[], principals: Record<PrincipalName, PrivatePrincipal>): void {
  const literal = (value: string | number | null) => value === null ? 'NULL' : sqlLiteral(String(value));
  const now = Date.now();
  const tickets = [
    ['fixture-tenant-a', 'beta2-open-assigned', 'Damaged item in recent delivery', 'open', 'fixture-customer', principals.customerA.email, 'fixture-operator', 'web', null],
    ['fixture-tenant-a', 'beta2-pending-unassigned', 'Change delivery address before dispatch', 'pending', 'fixture-customer', principals.customerA.email, null, 'portal', null],
    ['fixture-tenant-a', 'beta2-snoozed-assigned', 'Follow-up after replacement arrives', 'open', 'fixture-customer', principals.customerA.email, 'fixture-operator', 'web', null],
    ['fixture-tenant-a', 'beta2-resolved', 'Replacement delivered successfully', 'resolved', 'fixture-customer', principals.customerA.email, 'fixture-operator', 'web', null],
    ['fixture-tenant-a', 'beta2-email', 'Question about invoice line items', 'open', 'fixture-customer', principals.customerA.email, 'fixture-operator', 'email', 'support@synthetic.example.test'],
    ['fixture-tenant-a', 'beta2-internal-attachment', 'Replacement handoff and receipt', 'open', 'fixture-customer', principals.customerA.email, 'fixture-operator', 'web', null],
    ['fixture-tenant-b', 'beta2-b-open-unassigned', 'Beta 2 tenant B open', 'open', 'fixture-customer', principals.customerB.email, null, 'portal', null],
    ['fixture-tenant-b', 'beta2-b-email', 'Beta 2 tenant B email', 'pending', 'fixture-customer', principals.customerB.email, 'fixture-operator', 'email', 'billing@synthetic.example.test'],
  ] as const;
  for (const [index, [tenantId, id, subject, status, customerId, customerEmail, assignedTo, source, sourceEmail]] of tickets.entries()) {
    const priority = id === 'beta2-open-assigned' || id === 'beta2-email' ? 'high' : id === 'beta2-pending-unassigned' ? 'low' : 'normal';
    rows.push(`INSERT INTO tickets (tenant_id,id,ticket_no,subject,status,priority,customer_id,customer_email,assigned_to,source,source_email,created_at,updated_at) VALUES (${[tenantId,id,index < 6 ? 201 + index : 301 + index - 6,subject,status,priority,customerId,customerEmail,assignedTo,source,sourceEmail,beta2MinutesAgo(now, beta2TicketAgeMinutes(id)),beta2MinutesAgo(now, beta2ArticleAgeMinutes(id))].map(literal).join(',')});`);
  }
  const articles = [
    ['fixture-tenant-a', 'beta2-article-open', 'beta2-open-assigned', 'fixture-customer', 'customer', 'The item arrived with a damaged corner. Could you help arrange a replacement?', 'plain', 0, 'web', null],
    ['fixture-tenant-a', 'beta2-article-pending', 'beta2-pending-unassigned', 'fixture-customer', 'customer', 'Can I change the delivery address before this order ships?', 'plain', 0, 'portal', null],
    ['fixture-tenant-a', 'beta2-article-snoozed', 'beta2-snoozed-assigned', 'fixture-operator', 'agent', 'I will check back once the replacement is delivered on Tuesday.', 'plain', 0, 'web', null],
    ['fixture-tenant-a', 'beta2-article-resolved', 'beta2-resolved', 'fixture-operator', 'agent', 'The replacement arrived and the original issue is resolved.', 'plain', 0, 'web', null],
    ['fixture-tenant-a', 'beta2-article-email', 'beta2-email', 'fixture-customer', 'customer', 'Hello support,\n\nCould you explain the additional line item on my invoice?\n\nThanks.', 'plain', 0, 'email', 'beta2-email-raw'],
    ['fixture-tenant-a', 'beta2-article-internal', 'beta2-internal-attachment', 'fixture-operator', 'agent', 'Private handoff: verify the replacement address against the attached receipt.', 'plain', 1, 'dashboard', null],
    ['fixture-tenant-b', 'beta2-article-b-open', 'beta2-b-open-unassigned', 'fixture-customer', 'customer', 'Tenant B synthetic request.', 'plain', 0, 'portal', null],
    ['fixture-tenant-b', 'beta2-article-b-email', 'beta2-b-email', 'fixture-customer', 'customer', 'Tenant B email body.', 'plain', 0, 'email', 'beta2-b-email-raw'],
  ] as const;
  for (const [tenantId,id,ticketId,senderId,senderType,body,bodyFormat,isInternal,intakeSource,rawEmailId] of articles) {
    rows.push(`INSERT INTO articles (tenant_id,id,ticket_id,sender_id,sender_type,body,snippet,body_format,is_internal,intake_source,raw_email_id,created_at) VALUES (${[tenantId,id,ticketId,senderId,senderType,body,body.substring(0, 250),bodyFormat,isInternal,intakeSource,rawEmailId,beta2MinutesAgo(now, beta2ArticleAgeMinutes(ticketId))].map(literal).join(',')});`);
  }
  rows.push(`INSERT INTO attachments (tenant_id,id,article_id,file_name,file_size,content_type,r2_key,created_at) VALUES (${['fixture-tenant-a','beta2-attachment-pdf','beta2-article-internal','order-summary.pdf',24576,'application/pdf','fixture-tenant-a/beta2-internal-attachment/order-summary.pdf','2026-09-10T09:20:00.000Z'].map(literal).join(',')});`);
  rows.push(`INSERT INTO attachments (tenant_id,id,article_id,file_name,file_size,content_type,r2_key,created_at) VALUES (${['fixture-tenant-b','beta2-attachment-image','beta2-article-b-email','invoice.png',8192,'image/png','fixture-tenant-b/beta2-b-email/invoice.png','2026-09-10T09:20:00.000Z'].map(literal).join(',')});`);
  rows.push(`UPDATE ticket_support_state SET snoozed_until='2099-01-01T12:00:00.000Z',resurface_reason='manual' WHERE tenant_id='fixture-tenant-a' AND ticket_id='beta2-snoozed-assigned';`);
  appendBeta2ReviewFixtureSql(rows, now);
  appendBeta2SlaFixtureSql(rows, now);
  appendBeta2PriorityFixtureSql(rows);
}

async function seedPrincipals(db: D1Database, env: Env, principals: Record<PrincipalName, PrivatePrincipal>): Promise<void> {
  const auth = new AuthService(env);
  const mfa = new MFAService();
  for (const name of principalNames) {
    const principal = principals[name];
    if (principal.role === 'admin') principal.mfaSecret = mfa.generateSecret();
    const passwordHash = await auth.hashPassword(principal.password);
    const encryptedMfaSecret = principal.mfaSecret ? await mfa.encryptSecret(principal.mfaSecret, env.MFA_ENCRYPTION_KEY) : null;
    await db.prepare(`INSERT INTO users
      (tenant_id, id, email, full_name, password_hash, role, mfa_secret, mfa_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(principal.tenantId, principal.localId, principal.email, `Synthetic ${name}`, passwordHash,
        principal.role, encryptedMfaSecret, principal.mfaSecret ? 1 : 0).run();
  }
}

async function seedFixtureTenantConfig(db: D1Database): Promise<void> {
  for (const tenantId of Object.keys(fixtureWidgetKeys) as Tenant[]) {
    await db.prepare('INSERT INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)').bind(tenantId, 'widget.public_key', fixtureWidgetKeys[tenantId]).run();
    await db.prepare('INSERT INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)').bind(tenantId, 'PORTAL_URL', 'http://localhost:5174').run();
  }
}

async function seedScopedTickets(db: D1Database, principals: Record<PrincipalName, PrivatePrincipal>, reviewBeta2: boolean): Promise<void> {
  const now = Date.now();
  const rows = [
    ['fixture-tenant-a', 'fixture-ticket', 'Fixture ticket A', principals.customerA.localId, principals.customerA.email],
    ['fixture-tenant-b', 'fixture-ticket', 'Fixture ticket B', principals.customerB.localId, principals.customerB.email],
    ['fixture-tenant-b', 'fixture-b-only', 'Fixture ticket B only', principals.customerB.localId, principals.customerB.email],
  ];
  for (const [tenantId, id, subject, customerId, customerEmail] of rows) {
    await db.prepare('INSERT INTO tickets (tenant_id, id, subject, customer_id, customer_email, source) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(tenantId, id, subject, customerId, customerEmail, 'fixture').run();
  }

  // Stable local-beta coverage data. Every row is synthetic and remains inside
  // its tenant scope so the dashboard can exercise queue and timeline states.
  const betaRows = [
    ['fixture-tenant-a', 'beta2-open-assigned', 'Damaged item in recent delivery', 'open', principals.customerA.localId, principals.customerA.email, principals.operatorA.localId, 'web', null],
    ['fixture-tenant-a', 'beta2-pending-unassigned', 'Change delivery address before dispatch', 'pending', principals.customerA.localId, principals.customerA.email, null, 'portal', null],
    ['fixture-tenant-a', 'beta2-snoozed-assigned', 'Follow-up after replacement arrives', 'open', principals.customerA.localId, principals.customerA.email, principals.operatorA.localId, 'web', null],
    ['fixture-tenant-a', 'beta2-resolved', 'Replacement delivered successfully', 'resolved', principals.customerA.localId, principals.customerA.email, principals.operatorA.localId, 'web', null],
    ['fixture-tenant-a', 'beta2-email', 'Question about invoice line items', 'open', principals.customerA.localId, principals.customerA.email, principals.operatorA.localId, 'email', 'support@synthetic.example.test'],
    ['fixture-tenant-a', 'beta2-internal-attachment', 'Replacement handoff and receipt', 'open', principals.customerA.localId, principals.customerA.email, principals.operatorA.localId, 'web', null],
    ['fixture-tenant-b', 'beta2-b-open-unassigned', 'Beta 2 tenant B open', 'open', principals.customerB.localId, principals.customerB.email, null, 'portal', null],
    ['fixture-tenant-b', 'beta2-b-email', 'Beta 2 tenant B email', 'pending', principals.customerB.localId, principals.customerB.email, principals.operatorB.localId, 'email', 'billing@synthetic.example.test'],
  ] as const;
  for (const [index, [tenantId, id, subject, status, customerId, customerEmail, assignedTo, source, sourceEmail]] of betaRows.entries()) {
    const priority = id === 'beta2-open-assigned' || id === 'beta2-email' ? 'high' : id === 'beta2-pending-unassigned' ? 'low' : 'normal';
    await db.prepare(`INSERT INTO tickets
      (tenant_id, id, ticket_no, subject, status, priority, customer_id, customer_email, assigned_to, source, source_email, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(tenantId, id, index < 6 ? 201 + index : 301 + index - 6, subject, status, priority, customerId, customerEmail, assignedTo, source, sourceEmail,
        beta2MinutesAgo(now, beta2TicketAgeMinutes(id)), beta2MinutesAgo(now, beta2ArticleAgeMinutes(id))).run();
  }

  const articles = [
    ['fixture-tenant-a', 'beta2-article-open', 'beta2-open-assigned', principals.customerA.localId, 'customer', 'The item arrived with a damaged corner. Could you help arrange a replacement?', 'plain', 0, 'web', null],
    ['fixture-tenant-a', 'beta2-article-pending', 'beta2-pending-unassigned', principals.customerA.localId, 'customer', 'Can I change the delivery address before this order ships?', 'plain', 0, 'portal', null],
    ['fixture-tenant-a', 'beta2-article-snoozed', 'beta2-snoozed-assigned', principals.operatorA.localId, 'agent', 'I will check back once the replacement is delivered on Tuesday.', 'plain', 0, 'web', null],
    ['fixture-tenant-a', 'beta2-article-resolved', 'beta2-resolved', principals.operatorA.localId, 'agent', 'The replacement arrived and the original issue is resolved.', 'plain', 0, 'web', null],
    ['fixture-tenant-a', 'beta2-article-email', 'beta2-email', principals.customerA.localId, 'customer', 'Hello support,\n\nCould you explain the additional line item on my invoice?\n\nThanks.', 'plain', 0, 'email', 'beta2-email-raw'],
    ['fixture-tenant-a', 'beta2-article-internal', 'beta2-internal-attachment', principals.operatorA.localId, 'agent', 'Private handoff: verify the replacement address against the attached receipt.', 'plain', 1, 'dashboard', null],
    ['fixture-tenant-b', 'beta2-article-b-open', 'beta2-b-open-unassigned', principals.customerB.localId, 'customer', 'Tenant B synthetic request.', 'plain', 0, 'portal', null],
    ['fixture-tenant-b', 'beta2-article-b-email', 'beta2-b-email', principals.customerB.localId, 'customer', 'Tenant B email body.', 'plain', 0, 'email', 'beta2-b-email-raw'],
  ] as const;
  for (const [tenantId, id, ticketId, senderId, senderType, body, bodyFormat, isInternal, intakeSource, rawEmailId] of articles) {
    await db.prepare(`INSERT INTO articles
      (tenant_id, id, ticket_id, sender_id, sender_type, body, snippet, body_format, is_internal, intake_source, raw_email_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(tenantId, id, ticketId, senderId, senderType, body, body.substring(0, 250), bodyFormat, isInternal, intakeSource, rawEmailId,
        beta2MinutesAgo(now, beta2ArticleAgeMinutes(ticketId))).run();
  }

  await db.prepare(`INSERT INTO attachments
    (tenant_id, id, article_id, file_name, file_size, content_type, r2_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind('fixture-tenant-a', 'beta2-attachment-pdf', 'beta2-article-internal', 'order-summary.pdf', 24576,
      'application/pdf', 'fixture-tenant-a/beta2-internal-attachment/order-summary.pdf', '2026-09-10T09:20:00.000Z').run();
  await db.prepare(`INSERT INTO attachments
    (tenant_id, id, article_id, file_name, file_size, content_type, r2_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind('fixture-tenant-b', 'beta2-attachment-image', 'beta2-article-b-email', 'invoice.png', 8192,
      'image/png', 'fixture-tenant-b/beta2-b-email/invoice.png', '2026-09-10T09:20:00.000Z').run();

  await db.prepare(`UPDATE ticket_support_state
    SET snoozed_until = ?, resurface_reason = ?
    WHERE tenant_id = ? AND ticket_id = ?`)
    .bind('2099-01-01T12:00:00.000Z', 'manual', 'fixture-tenant-a', 'beta2-snoozed-assigned').run();
  if (reviewBeta2) {
    // Keep the general-purpose test ticket out of the review Inbox's first 20
    // without changing baseline tests that initialize its SLA at creation time.
    await db.prepare("UPDATE tickets SET created_at=?,updated_at=? WHERE tenant_id='fixture-tenant-a' AND id='fixture-ticket'")
      .bind(beta2MinutesAgo(now, 43_200), beta2MinutesAgo(now, 43_200)).run();
    const reviewStatements: string[] = [];
    appendBeta2ReviewFixtureSql(reviewStatements, now);
    appendBeta2SlaFixtureSql(reviewStatements, now);
    appendBeta2PriorityFixtureSql(reviewStatements);
    await db.batch(reviewStatements.map(statement => db.prepare(statement)));
  }
}

function countedR2Bucket(bucket: R2Bucket): FixtureR2 {
  const counts = { get: 0, put: 0, delete: 0, list: 0 };
  let nextPutFailure: boolean | undefined;
  let nextGetPause: { started: () => void; released: Promise<void> } | undefined;
  const counted = new Proxy(bucket, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || !['get', 'put', 'delete', 'list'].includes(String(property))) return value;
      return (...args: unknown[]) => {
        counts[property as keyof typeof counts]++;
        if (property === 'get' && nextGetPause) {
          const pause = nextGetPause; nextGetPause = undefined;
          pause.started();
          return pause.released.then(() => value.apply(target, args));
        }
        if (property === 'put' && nextPutFailure !== undefined) {
          const uncertain = nextPutFailure; nextPutFailure = undefined;
          return (async () => { if (uncertain) await value.apply(target,args); throw new Error('Synthetic local storage failure'); })();
        }
        return value.apply(target, args);
      };
    },
  }) as R2Bucket;
  return Object.freeze({
    bucket: counted,
    operationCounts: () => Object.freeze({ ...counts }),
    failNextPut: (uncertain = false) => { nextPutFailure = uncertain; },
    pauseNextGet: () => {
      assert.equal(nextGetPause, undefined, 'Only one synthetic read pause may be pending');
      let started!: () => void;
      let release!: () => void;
      const entered = new Promise<void>(resolve => { started = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      nextGetPause = { started, released };
      return Object.freeze({ started: entered, release });
    },
  });
}

/**
 * Creates only in-memory local D1/R2 bindings. The callback receives route-level
 * handles; plaintext synthetic credentials never appear in a report or filesystem.
 */
export async function withTwoTenantFixture<T>(callback: (fixture: LocalTenantFixture) => Promise<T>, options: { reviewBeta2?: boolean } = {}): Promise<T> {
  const headersGlobal = globalThis as typeof globalThis & { Headers: typeof MiniflareHeaders };
  const originalHeaders = headersGlobal.Headers;
  Object.assign(headersGlobal, { Headers: MiniflareHeaders });
  let miniflare: Miniflare | undefined;

  try {
    const durableObjectBundle = await build({
      entryPoints: [resolve(import.meta.dirname, 'budget-admission-runtime-entry.ts')],
      bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false,
    });
    miniflare = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: fixtureMarker,
      modules: true,
      compatibilityDate: '2024-04-03',
      compatibilityFlags: ['nodejs_compat'],
      script: durableObjectBundle.outputFiles[0].text,
      d1Databases: { DB: 'e2d1b2a2-b2f8-42f4-82f7-0c58f5371e58' },
      r2Buckets: ['ATTACHMENTS_BUCKET'],
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' },
      unsafeEphemeralDurableObjects: true,
    }] }));
    const db = await miniflare.getD1Database('DB');
    const rawBucket = await miniflare.getR2Bucket('ATTACHMENTS_BUCKET') as unknown as R2Bucket;
    const r2 = countedR2Bucket(rawBucket);
    let notificationAttempts = 0;
    let remainingNotificationFailures = 0;
    const notificationDo = {
      idFromName: (name: string) => name,
      get: (_id: string) => ({
        fetch: async () => {
          notificationAttempts++;
          if (remainingNotificationFailures > 0) {
            remainingNotificationFailures--;
            throw new Error('Synthetic local notification failure');
          }
          return new Response(null, { status: 204 });
        },
      }),
    } as unknown as DurableObjectNamespace;
    const budgetCoordinator = await miniflare.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace;
    const budgetGrantHolder = await miniflare.getDurableObjectNamespace('BUDGET_GRANT_HOLDER_DO') as unknown as DurableObjectNamespace;
    const env: Env = { ...localEnv(db, r2.bucket), NOTIFICATION_DO: notificationDo,
      BUDGET_COORDINATOR_DO: budgetCoordinator, BUDGET_GRANT_HOLDER_DO: budgetGrantHolder };
    const privatePrincipals = generatedPrincipals();
    let localRuntime = createLocalRuntime();
    const requestIp = `fixture-run-${++fixtureRun}`;
    let routeRequests = 0;
    await applyMigrations(db);
    await seedPrincipals(db, env, privatePrincipals);
    await seedFixtureTenantConfig(db);
    await seedScopedTickets(db, privatePrincipals, options.reviewBeta2 === true);

    const request: LocalTenantFixture['request'] = async (path, options = {}) => {
      assert.ok(path.startsWith('/'), 'Fixture requests must use an application path');
      routeRequests++;
      const headers = new Headers(options.headers);
      const suppliedBody = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
      if (options.contentType === null) headers.delete('Content-Type');
      else if (options.contentType !== undefined) headers.set('Content-Type', options.contentType);
      else if (suppliedBody !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      if (options.idempotencyKey !== undefined) headers.set('Idempotency-Key', options.idempotencyKey);
      if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
      if (options.apiKey) headers.set('X-API-Key', options.apiKey);
      if (options.origin) headers.set('Origin', options.origin);
      headers.set('cf-connecting-ip', options.ip ?? requestIp);
      const response = await localRuntime.fetch(new Request(`http://localhost:8787${path}`, {
        method: options.method ?? 'GET', headers,
        ...(suppliedBody === undefined ? {} : { body: suppliedBody }),
      }), env, {} as ExecutionContext);
      return response as FixtureResponse;
    };

    const fixture: LocalTenantFixture = Object.freeze({
      enableLocalBeta: () => { env.LOCAL_BETA_ENABLED = 'true'; },
      enableIsolatedObservability: () => { env.OBSERVABILITY_MODE = 'isolated-evidence'; },
      enableCombinedTicketAdmission: () => enableTicketAdmission(env, db, 'ticket-mutations-v1'),
      enableApiTicketAdmission: () => enableTicketAdmission(env, db, 'api-ticket-mutations-v1'),
      restartLocalRuntime: () => { localRuntime = createLocalRuntime(); },
      principals: Object.freeze(Object.fromEntries(principalNames.map(name => [name, publicPrincipal(name, privatePrincipals[name])])) as Record<PrincipalName, FixturePrincipal>),
      db,
      r2,
      rateLimitIdentity: requestIp,
      request,
      login: (principal, password = privatePrincipals[principal].password) => request('/api/auth/login', {
        method: 'POST', body: { email: privatePrincipals[principal].email, password },
      }),
      tokenTenant: async token => {
        const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET), { audience: 'app' });
        const tenantId = (payload as { tenant_id?: unknown }).tenant_id;
        if (tenantId !== 'fixture-tenant-a' && tenantId !== 'fixture-tenant-b') throw new Error('Fixture token has no valid tenant claim');
        return tenantId;
      },
      widgetTokenTenant: async token => {
        const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET), { audience: 'widget' });
        const tenantId = (payload as { tenant_id?: unknown }).tenant_id;
        if (tenantId !== 'fixture-tenant-a' && tenantId !== 'fixture-tenant-b') throw new Error('Fixture widget token has no valid tenant claim');
        return tenantId;
      },
      currentMfaCode: principal => {
        const secret = privatePrincipals[principal].mfaSecret;
        if (!secret) throw new Error('Fixture operator MFA secret is unavailable');
        return mfaCode(secret);
      },
      invalidMfaCode: principal => {
        const secret = privatePrincipals[principal].mfaSecret;
        if (!secret) throw new Error('Fixture operator MFA secret is unavailable');
        const verifier = new MFAService();
        for (let candidate = 0; candidate < 1_000_000; candidate++) {
          const code = String(candidate).padStart(6, '0');
          if (!verifier.verifyCode(code, secret)) return code;
        }
        throw new Error('Unable to derive a deliberately invalid fixture OTP');
      },
      createAgentSession: async (tenantId, mfaVerified = true) => {
        const id = `fixture-agent-${crypto.randomUUID()}`;
        const email = `${id}@example.test`;
        await db.prepare('INSERT INTO users (tenant_id, id, email, full_name, role, mfa_enabled, session_version) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(tenantId, id, email, 'Synthetic route agent', 'agent', 1, 1).run();
        const token = await new AuthService().generateToken({
          id, email, full_name: 'Synthetic route agent', role: 'agent', tenant_id: tenantId, mfa_enabled: true, session_version: 1,
        } as any, env.JWT_SECRET, mfaVerified);
        return Object.freeze({ id, token });
      },
      createScopedApiKey: async (operator, permissions) => {
        assert.ok(permissions.length > 0 && permissions.every(permission => permission === 'tickets:read' || permission === 'tickets:write'), 'Fixture API-key permissions must be ticket permissions');
        const principal = privatePrincipals[operator];
        assert.equal(principal.role, 'admin', 'Fixture API keys are available only for its fixed synthetic operators');
        const repositories = createRepositories(
          createSystemTenantScope({ tenantId: principal.tenantId, actor: 'synthetic-fixture-key-bootstrap' }),
          db,
        );
        const created = await repositories.apiKeys.create(`fixture-${operator}`, [...permissions]);
        return Object.freeze({ id: created.id, apiKey: created.apiKey, permissions: Object.freeze([...permissions]) });
      },
      revokePrincipalSessions: async principal => {
        const identity = privatePrincipals[principal];
        await db.prepare('UPDATE users SET session_version = session_version + 1 WHERE tenant_id = ? AND id = ?')
          .bind(identity.tenantId, identity.localId).run();
      },
      assertStoredCredentialProtection: async rawApiKey => {
        const rows = await db.prepare('SELECT email, password_hash, mfa_secret, mfa_enabled FROM users WHERE email IN (?, ?, ?, ?)').bind(...principalNames.map(name => privatePrincipals[name].email)).all<{
          email: string; password_hash: string; mfa_secret: string | null; mfa_enabled: number;
        }>();
        const credentialRows = rows.results as Array<{ email: string; password_hash: string; mfa_secret: string | null; mfa_enabled: number }>;
        assert.equal(credentialRows.length, 4);
        for (const principal of Object.values(privatePrincipals)) {
          const stored = credentialRows.find((row) => row.email === principal.email);
          assert.ok(stored?.password_hash && stored.password_hash !== principal.password && stored.password_hash.includes(':'));
          if (principal.mfaSecret) assert.ok(stored.mfa_enabled === 1 && stored.mfa_secret && stored.mfa_secret !== principal.mfaSecret);
          else assert.ok(stored?.mfa_enabled === 0 && stored.mfa_secret === null);
        }
        const keys = await db.prepare('SELECT key_hash, prefix, permissions, is_active FROM api_keys').all<{ key_hash: string; prefix: string; permissions: string; is_active: number }>();
        const storedKeys = keys.results as Array<{ key_hash: string; prefix: string; permissions: string; is_active: number }> ;
        assert.ok(storedKeys.length >= 1 && storedKeys.every((key) => key.key_hash !== rawApiKey && !key.key_hash.includes(rawApiKey) && key.prefix.length === 8));
      },
      resourceUsage: async () => {
        const rows = await db.prepare(`SELECT
          (SELECT count(*) FROM users) + (SELECT count(*) FROM tickets) + (SELECT count(*) FROM api_keys) AS count`).first<{ count: number }>();
        const objects = await r2.bucket.list();
        return Object.freeze({ d1Rows: rows?.count ?? 0, r2Objects: objects.objects.length, routeRequests });
      },
      notificationAttempts: () => notificationAttempts,
      resetNotificationAttempts: () => { notificationAttempts = 0; remainingNotificationFailures = 0; },
      failNotificationAttempts: count => {
        assert.ok(Number.isSafeInteger(count) && count >= 0, 'Notification failure count must be a non-negative integer');
        remainingNotificationFailures = count;
      },
    });
    return await callback(fixture);
  } finally {
    Object.assign(headersGlobal, { Headers: originalHeaders });
    await miniflare?.dispose();
  }
}

function tokenFrom(value: unknown): string {
  const token = (value as { token?: unknown })?.token;
  if (typeof token !== 'string') throw new Error('Expected an application token without reporting it');
  return token;
}

async function assertStatus(response: FixtureResponse, expected: number, message: string): Promise<void> {
  if (response.status !== expected) {
    await response.body?.cancel();
    assert.fail(`${message}: received status ${response.status}`);
  }
}

/** Executes the approved route-level two-tenant proof without logging secrets. */
export async function verifyTwoTenantFixture(): Promise<FixtureReport> {
  const started = Date.now();
  return withTwoTenantFixture(async fixture => {
    const customerAToken = tokenFrom(await (await fixture.login('customerA')).json());
    const customerBToken = tokenFrom(await (await fixture.login('customerB')).json());
    await assertStatus(await fixture.login('customerA', 'not-the-generated-password'), 401, 'Wrong customer password must be denied');

    const customerAIdentity = await (await fixture.request('/api/auth/me', { token: customerAToken })).json<{ user: { email: string; id: string } }>();
    const customerBIdentity = await (await fixture.request('/api/auth/me', { token: customerBToken })).json<{ user: { email: string; id: string } }>();
    assert.equal(customerAIdentity.user.email, fixture.principals.customerA.email);
    assert.equal(customerAIdentity.user.id, fixture.principals.customerA.localId);
    assert.equal(customerBIdentity.user.email, fixture.principals.customerB.email);
    assert.equal(customerBIdentity.user.id, fixture.principals.customerB.localId);
    assert.equal(await fixture.tokenTenant(customerAToken), fixture.principals.customerA.tenantId);
    assert.equal(await fixture.tokenTenant(customerBToken), fixture.principals.customerB.tenantId);

    for (const customer of ['customerA', 'customerB'] as const) {
      const principal = fixture.principals[customer];
      await assertStatus(await fixture.request('/api/v1/customer/auth/request', {
        method: 'POST', ip: `${fixture.rateLimitIdentity}-widget-${customer}`, body: { email: principal.email, type: 'magic_link', widgetKey: principal.widgetKey },
      }), 200, 'Customer magic-link request must use its scoped widget key');
      const messages = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to: string; loginLink?: string }>>();
      const message = messages.find(candidate => candidate.to === principal.email);
      assert.ok(message?.loginLink, 'Local capture must retain the selected approved recipient and link');
      const link = new URL(message.loginLink!);
      assert.equal(link.origin, 'http://localhost:5174');
      assert.equal(link.pathname, '/verify');
      assert.equal(link.searchParams.get('key'), principal.widgetKey);
      const token = link.searchParams.get('token');
      assert.ok(token && /^[0-9a-f]{64}$/.test(token), 'Captured local link must contain an opaque auth token');
      const other = customer === 'customerA' ? fixture.principals.customerB : fixture.principals.customerA;
      await assertStatus(await fixture.request('/api/v1/customer/auth/verify', {
        method: 'POST', ip: `${fixture.rateLimitIdentity}-widget-${customer}`, body: { token, widgetKey: other.widgetKey },
      }), 401, 'Wrong tenant widget key must not redeem a customer link');
      const verified = await (await fixture.request('/api/v1/customer/auth/verify', {
        method: 'POST', ip: `${fixture.rateLimitIdentity}-widget-${customer}`, body: { token, widgetKey: principal.widgetKey },
      })).json<{ token: string; user: { tenant_id: string; email: string } }>();
      assert.equal(await fixture.widgetTokenTenant(verified.token), principal.tenantId);
      assert.equal(verified.user.tenant_id, principal.tenantId);
      assert.equal(verified.user.email, principal.email);
      const widgetIdentity = await (await fixture.request('/api/v1/customer/auth/me', { token: verified.token })).json<{ user: { tenant_id: string; email: string } }>();
      assert.equal(widgetIdentity.user.tenant_id, principal.tenantId);
      assert.equal(widgetIdentity.user.email, principal.email);
      await assertStatus(await fixture.request('/api/v1/customer/auth/verify', {
        method: 'POST', ip: `${fixture.rateLimitIdentity}-widget-${customer}`, body: { token, widgetKey: principal.widgetKey },
      }), 401, 'Customer link replay must be denied');
    }

    const operatorTokens: Partial<Record<'operatorA' | 'operatorB', string>> = {};
    for (const operator of ['operatorA', 'operatorB'] as const) {
      const challenge = await (await fixture.login(operator)).json<{ mfa_required: boolean; token: string }>();
      assert.equal(challenge.mfa_required, true, 'Fixture operator login must require MFA');
      await assertStatus(await fixture.request('/api/auth/mfa/verify', {
        method: 'POST', token: challenge.token, body: { code: fixture.invalidMfaCode(operator) },
      }), 400, 'Authenticated wrong operator OTP must permit correction without granting access');
      await assertStatus(await fixture.request('/api/api-keys', { token: challenge.token }), 401, 'MFA challenge token must not reach dashboard metadata');
      operatorTokens[operator] = tokenFrom(await (await fixture.request('/api/auth/mfa/verify', {
        method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(operator) },
      })).json());
    }

    const aToken = operatorTokens.operatorA!;
    const bToken = operatorTokens.operatorB!;
    const aKey = await (await fixture.request('/api/api-keys', { method: 'POST', token: aToken, body: { name: 'fixture-a-read' } })).json<{ id: string; apiKey: string }>();
    const bKey = await (await fixture.request('/api/api-keys', { method: 'POST', token: bToken, body: { name: 'fixture-b-read' } })).json<{ id: string; apiKey: string }>();
    assert.equal(typeof aKey.apiKey, 'string', 'API key stays only in local memory');
    assert.equal(typeof bKey.apiKey, 'string', 'API key stays only in local memory');

    const aMetadata = await (await fixture.request('/api/api-keys', { token: aToken })).json<Array<{ id: string }>>();
    const bMetadata = await (await fixture.request('/api/api-keys', { token: bToken })).json<Array<{ id: string }>>();
    assert.deepEqual(aMetadata.map(key => key.id), [aKey.id]);
    assert.deepEqual(bMetadata.map(key => key.id), [bKey.id]);
    await assertStatus(await fixture.request(`/api/api-keys/${bKey.id}`, { method: 'DELETE', token: aToken }), 200, 'Cross-tenant delete response');
    const bMetadataAfterForeignDelete = await (await fixture.request('/api/api-keys', { token: bToken })).json<Array<{ id: string }>>();
    assert.deepEqual(bMetadataAfterForeignDelete.map(key => key.id), [bKey.id], 'A cannot revoke B metadata');

    const aScopedTicket = await (await fixture.request('/api/v1/tickets/fixture-ticket', { apiKey: aKey.apiKey })).json<{ subject: string }>();
    const bScopedTicket = await (await fixture.request('/api/v1/tickets/fixture-ticket', { apiKey: bKey.apiKey })).json<{ subject: string }>();
    assert.equal(aScopedTicket.subject, 'Fixture ticket A');
    assert.equal(bScopedTicket.subject, 'Fixture ticket B');
    await assertStatus(await fixture.request('/api/v1/tickets/fixture-b-only', { apiKey: aKey.apiKey }), 404, 'A key cannot read B-only ticket');
    await assertStatus(await fixture.request('/api/v1/tickets/fixture-b-only', { apiKey: bKey.apiKey }), 200, 'B key can read B-only ticket');
    const ticketRowsBefore = await fixture.db.prepare('SELECT count(*) AS count FROM tickets').first<{ count: number }>();
    await assertStatus(await fixture.request('/api/v1/tickets', {
      method: 'POST', apiKey: aKey.apiKey,
      body: { subject: 'must-not-write', customer_email: fixture.principals.customerA.email },
    }), 403, 'Read-only key must not write');
    await assertStatus(await fixture.request('/api/v1/tickets', { method: 'POST' }), 401, 'Missing key must be denied');
    await assertStatus(await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: 'malformed' }), 401, 'Malformed key must be denied');
    const ticketRowsAfter = await fixture.db.prepare('SELECT count(*) AS count FROM tickets').first<{ count: number }>();
    assert.equal(ticketRowsAfter?.count, ticketRowsBefore?.count, 'Denied key requests must not write tickets');

    await fixture.assertStoredCredentialProtection(aKey.apiKey);
    const duplicateRevocations = await Promise.all([0, 1].map(() => fixture.request(`/api/api-keys/${aKey.id}`, { method: 'DELETE', token: aToken })));
    for (const response of duplicateRevocations) await assertStatus(response, 200, 'Concurrent owner key revocation is idempotent');
    await assertStatus(await fixture.request('/api/v1/tickets/not-a-ticket', { apiKey: aKey.apiKey }), 401, 'Revoked key must be denied');

    await fixture.db.prepare('UPDATE users SET role = ? WHERE tenant_id = ? AND id = ?')
      .bind('customer', fixture.principals.operatorB.tenantId, fixture.principals.operatorB.localId).run();
    await assertStatus(await fixture.request('/api/api-keys', { token: bToken }), 401, 'Current D1 role/session change must deny stale operator token');

    await assert.rejects(
      fixture.db.prepare('INSERT INTO users (tenant_id, id, email, role) VALUES (?, ?, ?, ?)')
        .bind(fixture.principals.customerB.tenantId, 'duplicate-email', ` ${fixture.principals.customerA.email.toUpperCase()} `, 'customer').run(),
      /UNIQUE constraint failed|SQLITE_CONSTRAINT/,
      'Canonical email collision must be rejected',
    );
    const foreignKeys = await fixture.db.prepare('PRAGMA foreign_key_check').all();
    assert.equal(foreignKeys.results.length, 0, 'Fresh fixture must satisfy foreign keys');

    const usage = await fixture.resourceUsage();
    return Object.freeze({
      result: 'passed', mode: 'disposable-miniflare', tenants: 2, principals: 4,
      customerPasswordLogins: 2, customerMagicLinkAuthentications: 2, operatorMfaLogins: 2, apiKeysCreated: 2,
      revokedKeysRejected: true, crossTenantMetadataWrites: 0,
      foreignKeyViolations: 0, remoteBindings: 0, ...usage, elapsedMs: Date.now() - started, cleanup: 'disposed',
    });
  });
}
