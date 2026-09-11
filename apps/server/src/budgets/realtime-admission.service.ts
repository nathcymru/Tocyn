import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import { IsolateBudgetAdmissionCache } from './isolate-admission.service';
import { SessionBudgetAdmissionService } from './session-admission.service';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import { estimateNotificationTypingWithCleanupEnvelope, estimateNotificationBroadcastWithCleanupEnvelope } from '../durable_objects/notification-resource-envelope';
import { sumResourceEnvelopes } from '../utils/cost-policy';
import type { BudgetCommitAuthority } from './isolate-admission.service';

export const REALTIME_BUDGET_POLICY = 'realtime-v1' as const;
export const MAX_REALTIME_LEASE_MS = 30_000;
/** Every accepted client frame spends one durable warm slot before D1/DO side effects. */
/** Existing 16-ticket, one-per-second typing contract across a 30-second lease. */
export const MAX_REALTIME_TYPING_EVENTS_PER_LEASE = 16 * 30;
/** Presence is advisory and now has its own one-per-second warm allowance. */
export const MAX_REALTIME_PRESENCE_EVENTS_PER_LEASE = 30;
/** Includes malformed/unknown frames, which must also be finite CPU work. */
export const MAX_REALTIME_EVENTS_PER_LEASE = MAX_REALTIME_TYPING_EVENTS_PER_LEASE + MAX_REALTIME_PRESENCE_EVENTS_PER_LEASE;
export const MAX_REALTIME_ALARMS_PER_LEASE = 1;
export const MAX_REALTIME_CLOSE_RECOVERIES_PER_LEASE = 1;
/** Receipt retention outlives released sockets for one lease interval without blocking routine reconnects. */
export const MAX_REALTIME_LEASE_RECEIPTS = 1_024;
/** Matches the existing coordinator's conservative DO SQLite state ceiling. */
export const MAX_REALTIME_RECEIPT_INDEX_BYTES = 120 * 1_024;

export type RealtimeAdmissionMode = 'disabled' | 'enabled' | 'invalid';
export type RealtimeLeaseClaim = Readonly<{
  version: 1; leaseId: string; tenantId: string; actorId: string; role: 'agent' | 'admin'; sessionVersion: number;
  expiresAt: number; authorityExpiresAt: number; authorityRevision: number; policyId: string; policyRevision: number;
  restrictionRevision: number; frames: number; typingEvents: number; presenceEvents: number; alarms: number; cleanups: number;
}>;
export type SignedRealtimeLease = Readonly<{ claim: RealtimeLeaseClaim; signature: string }>;

/**
 * Opaque-to-clients evidence that a canonical ticket mutation already reserved
 * this exact notification fanout.  The mutation services create it only after
 * their D1 commit returned; BroadcastService binds the final payload before it
 * crosses into NotificationDO.
 */
export type CanonicalBroadcastGrant = Readonly<{
  version: 1; handoffId: string; tenantId: string; operationId: string; operationFingerprint: string;
  reservationId: string; holderId: string; aggregateId: string; expiresAt: number;
  authorityRevision: number; policyId: string; policyRevision: number; restrictionRevision: number;
  notificationEnvelope: ResourceAmounts; operationEnvelope: ResourceAmounts;
}>;
export type SignedCanonicalBroadcastHandoff = Readonly<{
  grant: CanonicalBroadcastGrant; payloadDigest: string; signature: string;
}>;

const realtimeCache = new IsolateBudgetAdmissionCache();
const realtimeAdmission = new SessionBudgetAdmissionService(realtimeCache);
const text = new TextEncoder();

export function realtimeAdmissionMode(env: Env): RealtimeAdmissionMode {
  // This independent switch preserves deployed websocket behavior until an
  // owner explicitly enables the #64 boundary; malformed values never fall
  // through to a partially admitted connection.
  if (env.REALTIME_BUDGET_ADMISSION_POLICY === undefined || env.REALTIME_BUDGET_ADMISSION_POLICY === 'off') return 'disabled';
  return env.REALTIME_BUDGET_ADMISSION_POLICY === REALTIME_BUDGET_POLICY ? 'enabled' : 'invalid';
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function canonical(claim: RealtimeLeaseClaim): string {
  return JSON.stringify([claim.version, claim.leaseId, claim.tenantId, claim.actorId, claim.role, claim.sessionVersion,
    claim.expiresAt, claim.authorityExpiresAt, claim.authorityRevision, claim.policyId, claim.policyRevision,
    claim.restrictionRevision, claim.frames, claim.typingEvents, claim.presenceEvents, claim.alarms, claim.cleanups]);
}
function canonicalAmounts(amounts: ResourceAmounts): string {
  return JSON.stringify(Object.entries(amounts).sort(([left], [right]) => left.localeCompare(right)));
}
function validAmounts(value: unknown): value is ResourceAmounts {
  const amounts = value as Record<string, unknown>;
  return record(value) && Object.entries(amounts).every(([dimension, amount]) =>
    /^[A-Za-z][A-Za-z0-9]*$/.test(dimension) && typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0);
}
function envelopeCovers(actual: ResourceAmounts, expected: ResourceAmounts): boolean {
  return Object.entries(expected).every(([dimension, value]) =>
    Number.isSafeInteger(value) && value >= 0 && (actual[dimension as keyof ResourceAmounts] ?? 0) >= value);
}
function scaleEnvelope(envelope: ResourceAmounts, count: number): ResourceAmounts {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid bounded realtime envelope multiplier');
  const scaled: ResourceAmounts = {};
  for (const [dimension, value] of Object.entries(envelope)) {
    const next = value * count;
    if (!Number.isSafeInteger(next)) throw new Error('Realtime envelope overflow');
    scaled[dimension as keyof ResourceAmounts] = next;
  }
  return Object.freeze(scaled);
}
/** The exact pre-paid advisory fanout used by canonical ticket mutation envelopes. */
export const CANONICAL_BROADCAST_ENVELOPE = Object.freeze(estimateNotificationBroadcastWithCleanupEnvelope());
function canonicalBroadcastGrant(grant: CanonicalBroadcastGrant, payloadDigest: string): string {
  return JSON.stringify([grant.version, grant.handoffId, grant.tenantId, grant.operationId, grant.operationFingerprint,
    grant.reservationId, grant.holderId, grant.aggregateId, grant.expiresAt, grant.authorityRevision, grant.policyId,
    grant.policyRevision, grant.restrictionRevision, canonicalAmounts(grant.notificationEnvelope),
    canonicalAmounts(grant.operationEnvelope), payloadDigest]);
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', text.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Fixed-width receipt keys bound input-controlled IDs before they enter DO storage. */
export async function realtimeReceiptKey(domain: 'lease' | 'broadcast', ...parts: string[]): Promise<string | null> {
  if (!parts.length || !parts.every(validId)) return null;
  try { return hex(await crypto.subtle.digest('SHA-256', text.encode(`tocyn:realtime-receipt:v1:${domain}:${JSON.stringify(parts)}`))); }
  catch { return null; }
}

/** Reject packed durable receipt records before a large value reaches SQLite storage. */
export function realtimeReceiptIndexBytes(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  try {
    const bytes = text.encode(JSON.stringify(value)).byteLength;
    return Number.isSafeInteger(bytes) && bytes <= MAX_REALTIME_RECEIPT_INDEX_BYTES ? bytes : null;
  } catch { return null; }
}

/** The Worker, not a websocket client, derives this domain-separated forwarding proof. */
export async function signRealtimeLease(secret: string, claim: RealtimeLeaseClaim): Promise<SignedRealtimeLease | null> {
  if (!secret || !validRealtimeLease(claim, Date.now(), false)) return null;
  try { return Object.freeze({ claim, signature: hex(await crypto.subtle.sign('HMAC', await signingKey(secret), text.encode(`tocyn:realtime-lease:v1:${canonical(claim)}`))) }); }
  catch { return null; }
}

export async function verifyRealtimeLease(secret: string, claimHeader: string | null, signature: string | null, now: number): Promise<RealtimeLeaseClaim | null> {
  if (!secret || !claimHeader || !signature || !Number.isSafeInteger(now)) return null;
  let claim: unknown;
  try { claim = JSON.parse(claimHeader); } catch { return null; }
  if (!validRealtimeLease(claim, now, true) || !/^[a-f0-9]{64}$/.test(signature)) return null;
  try {
    const supplied = Uint8Array.from(signature.match(/.{2}/g)!, value => Number.parseInt(value, 16));
    return await crypto.subtle.verify('HMAC', await signingKey(secret), supplied, text.encode(`tocyn:realtime-lease:v1:${canonical(claim)}`)) ? Object.freeze(claim) : null;
  } catch { return null; }
}

/**
 * Returns a non-client-constructible broadcast capability after the mutation
 * service observed its successful canonical D1 commit.  A receipt replay is
 * deliberately excluded by the caller, preserving winning-only fanout.
 */
export function canonicalBroadcastGrantAfterCommit(authority: BudgetCommitAuthority | undefined, tenantId: string, now = Date.now()): CanonicalBroadcastGrant | null {
  const reservation = authority?.grant;
  if (!authority || !reservation || !validId(tenantId) || now >= authority.expiresAt) return null;
  const snapshot = authority.snapshot;
  let restrictionRevision: number;
  try { restrictionRevision = (JSON.parse(snapshot.restriction_json) as { revision?: unknown }).revision as number; }
  catch { return null; }
  if (!Number.isSafeInteger(restrictionRevision) || restrictionRevision < 1
    || !envelopeCovers(reservation.operationEnvelope, CANONICAL_BROADCAST_ENVELOPE)) return null;
  const ids = [authority.operationId, authority.operationFingerprint, reservation.reservationId, reservation.holderId,
    reservation.aggregateId, snapshot.policy_id];
  if (!ids.every(validId) || !Number.isSafeInteger(snapshot.authority_revision) || snapshot.authority_revision < 1
    || !Number.isSafeInteger(snapshot.policy_revision) || snapshot.policy_revision < 1) return null;
  return Object.freeze({ version: 1,
    handoffId: `canonical:${reservation.reservationId}:${authority.operationId}`,
    tenantId, operationId: authority.operationId, operationFingerprint: authority.operationFingerprint,
    reservationId: reservation.reservationId, holderId: reservation.holderId, aggregateId: reservation.aggregateId,
    expiresAt: authority.expiresAt, authorityRevision: snapshot.authority_revision, policyId: snapshot.policy_id,
    policyRevision: snapshot.policy_revision, restrictionRevision,
    notificationEnvelope: CANONICAL_BROADCAST_ENVELOPE, operationEnvelope: reservation.operationEnvelope,
  });
}

export function validCanonicalBroadcastGrant(grant: unknown, now: number): grant is CanonicalBroadcastGrant {
  const candidate = grant as CanonicalBroadcastGrant;
  if (!record(grant) || candidate.version !== 1 || !validId(candidate.handoffId) || !validId(candidate.tenantId)
    || ![candidate.operationId, candidate.operationFingerprint, candidate.reservationId, candidate.holderId, candidate.aggregateId, candidate.policyId].every(validId)
    || !Number.isSafeInteger(candidate.expiresAt) || now >= candidate.expiresAt
    || ![candidate.authorityRevision, candidate.policyRevision, candidate.restrictionRevision].every(value => Number.isSafeInteger(value) && value > 0)
    || !validAmounts(candidate.notificationEnvelope) || !validAmounts(candidate.operationEnvelope)) return false;
  return canonicalAmounts(candidate.notificationEnvelope) === canonicalAmounts(CANONICAL_BROADCAST_ENVELOPE)
    && envelopeCovers(candidate.operationEnvelope, CANONICAL_BROADCAST_ENVELOPE);
}

/** BroadcastService signs the immutable wire body, preventing a capability from being repurposed for another event. */
export async function signCanonicalBroadcastHandoff(secret: string, grant: CanonicalBroadcastGrant, body: string, now = Date.now()): Promise<SignedCanonicalBroadcastHandoff | null> {
  if (!secret || !validCanonicalBroadcastGrant(grant, now)) return null;
  try {
    const payloadDigest = hex(await crypto.subtle.digest('SHA-256', text.encode(body)));
    const signature = hex(await crypto.subtle.sign('HMAC', await signingKey(secret), text.encode(`tocyn:canonical-broadcast:v1:${canonicalBroadcastGrant(grant, payloadDigest)}`)));
    return Object.freeze({ grant, payloadDigest, signature });
  } catch { return null; }
}

export async function verifyCanonicalBroadcastHandoff(secret: string, encoded: string | null, signature: string | null, body: string, now: number): Promise<SignedCanonicalBroadcastHandoff | null> {
  if (!secret || !encoded || !signature || !/^[a-f0-9]{64}$/.test(signature) || !Number.isSafeInteger(now)) return null;
  let signed: unknown;
  try { signed = JSON.parse(encoded); } catch { return null; }
  if (!record(signed) || signed.signature !== signature || !validCanonicalBroadcastGrant(signed.grant, now)
    || typeof signed.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(signed.payloadDigest)) return null;
  try {
    const digest = hex(await crypto.subtle.digest('SHA-256', text.encode(body)));
    if (digest !== signed.payloadDigest) return null;
    const supplied = Uint8Array.from(signature.match(/.{2}/g)!, value => Number.parseInt(value, 16));
    const valid = await crypto.subtle.verify('HMAC', await signingKey(secret), supplied,
      text.encode(`tocyn:canonical-broadcast:v1:${canonicalBroadcastGrant(signed.grant, signed.payloadDigest)}`));
    return valid ? Object.freeze({ grant: Object.freeze(signed.grant), payloadDigest: signed.payloadDigest, signature }) : null;
  } catch { return null; }
}

export function validRealtimeLease(claim: unknown, now: number, requireCurrent: boolean): claim is RealtimeLeaseClaim {
  const candidate = claim as RealtimeLeaseClaim;
  if (!record(claim)) return false;
  return candidate.version === 1 && validId(candidate.leaseId) && validId(candidate.tenantId) && validId(candidate.actorId)
    && (candidate.role === 'agent' || candidate.role === 'admin') && Number.isSafeInteger(candidate.sessionVersion) && candidate.sessionVersion >= 0
    && Number.isSafeInteger(candidate.expiresAt) && Number.isSafeInteger(candidate.authorityExpiresAt)
    && Number.isSafeInteger(candidate.authorityRevision) && candidate.authorityRevision > 0 && validId(candidate.policyId)
    && Number.isSafeInteger(candidate.policyRevision) && candidate.policyRevision > 0 && Number.isSafeInteger(candidate.restrictionRevision) && candidate.restrictionRevision > 0
    && candidate.frames === MAX_REALTIME_EVENTS_PER_LEASE && candidate.typingEvents === MAX_REALTIME_TYPING_EVENTS_PER_LEASE
    && candidate.presenceEvents === MAX_REALTIME_PRESENCE_EVENTS_PER_LEASE && candidate.alarms === MAX_REALTIME_ALARMS_PER_LEASE && candidate.cleanups === MAX_REALTIME_CLOSE_RECOVERIES_PER_LEASE
    && candidate.expiresAt <= candidate.authorityExpiresAt && (!requireCurrent || now < candidate.expiresAt);
}

/**
 * A lease prepays a finite 30-second connection lifecycle: one initial
 * presence broadcast, the existing 16-ticket/second typing cadence for all
 * 30 seconds plus 30 presence frames, one shared alarm and one
 * close/error recovery. Client-frame debits are persisted by NotificationDO
 * before their D1/DO work. Canonical mutation broadcasts remain separately
 * prepaid by their mutation envelope and are deliberately absent here.
 */
export function realtimeConnectionEnvelope(): ResourceAmounts {
  const alarm = { doRequests: 1, doRowsWritten: 1, doRowsRead: 256, d1RowsRead: 1_536 };
  // Every lease debit and every recipient's lease fence is persisted in the
  // tenant object.  70,000 reads/1,100 writes covers installation, 510 frames,
  // initial sync/fanout, one alarm and one pending-close recovery at 128
  // sockets; it is intentionally independent of the D1 revalidation bounds.
  return Object.freeze(sumResourceEnvelopes({ workerRequests: 1, doRequests: 1, doRowsRead: 70_000, doRowsWritten: 1_100, d1RowsRead: 1_536,
    ...estimateDiagnosticEnvelope({ httpRequests: 1, durableObjectRevalidations: 3 }),
  }, estimateNotificationBroadcastWithCleanupEnvelope(), alarm,
  scaleEnvelope(estimateNotificationTypingWithCleanupEnvelope(), MAX_REALTIME_EVENTS_PER_LEASE)));
}

export type RealtimeConnectionAdmission = Readonly<{ status: 'disabled' | 'admitted' | 'rejected'; reason?: 'exhausted' | 'unavailable'; lease?: SignedRealtimeLease }>;

export async function admitRealtimeConnection(input: {
  env: Env; user: { id: string; tenant_id: string; role: string; session_version: number; session_expires_at: number };
  deps: Pick<TenantRequestDeps, 'scope' | 'database' | 'repositories'>;
  now: () => number;
}): Promise<RealtimeConnectionAdmission> {
  const mode = realtimeAdmissionMode(input.env);
  if (mode === 'disabled') return { status: 'disabled' };
  const now = input.now();
  const user = input.user;
  const scope = input.deps.scope;
  if (mode === 'invalid' || !input.env.BUDGET_COORDINATOR_DO || !input.env.JWT_SECRET
    || (user.role !== 'agent' && user.role !== 'admin') || !validId(user.id) || !validId(user.tenant_id)
    || !Number.isSafeInteger(user.session_version) || !Number.isSafeInteger(user.session_expires_at) || user.session_expires_at * 1_000 <= now
    || scope.tenantId !== user.tenant_id || scope.actorId !== user.id || scope.authVersion !== user.session_version || !scope.roles.includes(user.role)) {
    return { status: 'rejected', reason: 'unavailable' };
  }
  const credential: SessionBudgetCredential = { tenantId: user.tenant_id, actorId: user.id, role: user.role,
    sessionVersion: user.session_version, expiresAt: user.session_expires_at, mfaVerified: true };
  const leaseId = crypto.randomUUID();
  try {
    const fingerprint = hex(await crypto.subtle.digest('SHA-256', text.encode(JSON.stringify(['realtime.connection.v1', leaseId, user.tenant_id, user.id, user.session_version]))));
    const outcome = await realtimeAdmission.admit({
      repository: input.deps.repositories.budgetAuthority, sessions: new SessionBudgetAuthorityRepository(input.deps.database, scope),
      namespace: input.env.BUDGET_COORDINATOR_DO, scope, credential, requirements: {},
      intent: { operationId: `realtime:${leaseId}`, operationFingerprint: fingerprint, workScopeKey: 'realtime.connection.v1' },
      business: realtimeConnectionEnvelope(), now: input.now,
    });
    if ((outcome.status !== 'spent' && outcome.status !== 'idempotent') || !outcome.commitAuthority) {
      return { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
    }
    const snapshot = outcome.commitAuthority.snapshot;
    const restriction = JSON.parse(snapshot.restriction_json) as { revision?: unknown };
    const expiresAt = Math.min(outcome.commitAuthority.expiresAt, now + MAX_REALTIME_LEASE_MS, user.session_expires_at * 1_000);
    const claim: RealtimeLeaseClaim = Object.freeze({ version: 1, leaseId, tenantId: user.tenant_id, actorId: user.id, role: user.role,
      sessionVersion: user.session_version, expiresAt, authorityExpiresAt: outcome.commitAuthority.expiresAt,
      authorityRevision: snapshot.authority_revision, policyId: snapshot.policy_id, policyRevision: snapshot.policy_revision,
      restrictionRevision: typeof restriction.revision === 'number' ? restriction.revision : -1,
      frames: MAX_REALTIME_EVENTS_PER_LEASE, typingEvents: MAX_REALTIME_TYPING_EVENTS_PER_LEASE,
      presenceEvents: MAX_REALTIME_PRESENCE_EVENTS_PER_LEASE, alarms: MAX_REALTIME_ALARMS_PER_LEASE, cleanups: MAX_REALTIME_CLOSE_RECOVERIES_PER_LEASE });
    const lease = await signRealtimeLease(input.env.JWT_SECRET, claim);
    return lease ? { status: 'admitted', lease } : { status: 'rejected', reason: 'unavailable' };
  } catch { return { status: 'rejected', reason: 'unavailable' }; }
}
