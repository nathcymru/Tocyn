import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { EncryptJWT, jwtDecrypt } from 'jose';
import type { VerifiedTenantScope } from '../types/tenant';
import {
  OPERATOR_ACTIVITY_KINDS, type ActivityPresentationCredential, type OperatorActivity,
  type OperatorActivityCursor, type OperatorActivityFacts, type OperatorActivityKind,
  type OperatorActivityPage, type OperatorActivityUnreadCount, type TrustedActivityAppend,
} from '../types/operator-activity';

const MAX_PAGE_SIZE = 50;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_FACT_KEYS = 16;
const MAX_FACT_VALUE_LENGTH = 256;
const MAX_CURSOR_LENGTH = 2048;
const CURSOR_TTL_SECONDS = 900;
const CURSOR_PURPOSE = 'tocyn-operator-activity-cursor-v1';
export const OPERATOR_ACTIVITY_CANDIDATE_LIMIT = 100;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const columns = `id,ticket_id,recipient_user_id,kind,source_id,producer_kind,producer_id,facts,
  receipt_fingerprint,revision,created_at,resurfaced_at,read_at,dismissed_at`;
const selectColumns = columns.split(',').map(column => `a.${column.trim()} AS ${column.trim()}`).join(',');

type Row = {
  id: string; ticket_id: string; recipient_user_id: string; kind: OperatorActivityKind; source_id: string;
  producer_kind: 'staff' | 'system'; producer_id: string | null; facts: string; receipt_fingerprint: string; revision: number;
  created_at: string; resurfaced_at: string | null; read_at: string | null; dismissed_at: string | null;
};
type SqlCondition = Readonly<{ sql: string; values: readonly (string | number)[] }>;
export type PreparedActivityAppend = Readonly<{ statement: D1PreparedStatement }>;
type ImmutableActivity = Readonly<{
  id: string; ticketId: string; recipientUserId: string; kind: OperatorActivityKind; sourceId: string;
  producerKind: 'staff' | 'system'; producerId: string | null; facts: string; resurfacedAt: string | null; fingerprint: string;
}>;

export class OperatorActivityConflictError extends Error {
  constructor(message = 'Activity source conflicts with its existing durable projection') { super(message); }
}

function activityFromRow(row: Row): OperatorActivity {
  const producer = row.producer_kind === 'staff'
    ? { kind: 'staff' as const, id: row.producer_id }
    : { kind: 'system' as const };
  return {
    id: row.id, ticketId: row.ticket_id, recipientUserId: row.recipient_user_id, kind: row.kind,
    sourceId: row.source_id, producer, facts: JSON.parse(row.facts) as OperatorActivityFacts,
    revision: row.revision, createdAt: row.created_at, resurfacedAt: row.resurfaced_at,
    readAt: row.read_at, dismissedAt: row.dismissed_at,
  };
}

function requireIdentifier(value: string, name: string): void {
  if (typeof value !== 'string' || value.length > MAX_IDENTIFIER_LENGTH || !identifier.test(value)) {
    throw new Error(`Invalid activity ${name}`);
  }
}

function canonicalFacts(facts: OperatorActivityFacts): string {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts) || Object.getPrototypeOf(facts) !== Object.prototype) {
    throw new Error('Activity facts must be a plain object');
  }
  const entries = Object.entries(facts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length > MAX_FACT_KEYS) throw new Error('Activity facts have too many fields');
  for (const [key, value] of entries) {
    if (!identifier.test(key) || key.length > 64) throw new Error('Activity facts have an invalid field');
    if (!(value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string')) {
      throw new Error('Activity facts must contain only primitive values');
    }
    if (typeof value === 'string' && new TextEncoder().encode(value).byteLength > MAX_FACT_VALUE_LENGTH) {
      throw new Error('Activity fact value is too large');
    }
  }
  const serialized = JSON.stringify(Object.fromEntries(entries));
  if (new TextEncoder().encode(serialized).byteLength > 1024) throw new Error('Activity facts are too large');
  return serialized;
}

function validTimestamp(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) throw new Error('Invalid activity resurfaced timestamp');
  return value;
}

async function fingerprint(value: Omit<ImmutableActivity, 'fingerprint'>): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(part => part.toString(16).padStart(2, '0')).join('');
}

/**
 * Durable projection access. It intentionally has no HTTP surface: trusted
 * producers compose statements into their canonical D1 batch, and consumers
 * receive only their own currently-authorized rows.
 */
export class OperatorActivityRepository {
  private cursorKeyPromise?: Promise<Uint8Array>;

  constructor(private readonly scope: VerifiedTenantScope, private readonly db: D1Database, private readonly cursorSecret?: string) {}

  private cursorKey(): Promise<Uint8Array> {
    if (!this.cursorSecret) throw new Error('Activity pagination key unavailable; restart pagination after configuration is restored');
    this.cursorKeyPromise ??= (async () => {
      const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(this.cursorSecret), 'HKDF', false, ['deriveBits']);
      return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256',
        salt: new Uint8Array(32), info: new TextEncoder().encode(CURSOR_PURPOSE) }, material, 256));
    })();
    return this.cursorKeyPromise;
  }

  private async decodeCursor(value: string | null | undefined): Promise<OperatorActivityCursor | null> {
    if (value == null || value === '') return null;
    try {
      if (typeof value !== 'string' || value.length > MAX_CURSOR_LENGTH) throw new Error();
      const { payload, protectedHeader } = await jwtDecrypt(value, await this.cursorKey(), {
        keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'],
        requiredClaims: ['exp', 'iat'], maxTokenAge: CURSOR_TTL_SECONDS,
      });
      if (protectedHeader.typ !== CURSOR_PURPOSE || payload.tenantId !== this.scope.tenantId
        || payload.actorId !== this.scope.actorId || payload.authVersion !== this.scope.authVersion
        || typeof payload.createdAt !== 'string' || payload.createdAt.length > 40 || !Number.isFinite(Date.parse(payload.createdAt))
        || typeof payload.id !== 'string' || !identifier.test(payload.id)) throw new Error();
      return { createdAt: payload.createdAt, id: payload.id };
    } catch {
      throw new Error('Invalid or expired activity cursor; restart pagination');
    }
  }

  private async encodeCursor(value: OperatorActivityCursor, credential: ActivityPresentationCredential): Promise<string> {
    return new EncryptJWT({ ...value, tenantId: this.scope.tenantId, actorId: this.scope.actorId, authVersion: this.scope.authVersion })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: CURSOR_PURPOSE }).setIssuedAt()
      .setExpirationTime(Math.min(credential.expiresAt, Math.floor(Date.now() / 1000) + CURSOR_TTL_SECONDS))
      .encrypt(await this.cursorKey());
  }

  private recipientAuthority(credential: ActivityPresentationCredential): SqlCondition {
    if ((credential.role !== 'agent' && credential.role !== 'admin')
      || credential.mfaVerified !== true || credential.sessionVersion !== this.scope.authVersion
      || !this.scope.roles.includes(credential.role) || !Number.isSafeInteger(credential.sessionVersion) || credential.sessionVersion < 0
      || !Number.isSafeInteger(credential.expiresAt)) return { sql: '0', values: [] };
    return {
      sql: `EXISTS (SELECT 1 FROM users u WHERE u.tenant_id=? AND u.id=? AND u.role=?
        AND u.session_version=? AND u.mfa_enabled=1 AND ? > unixepoch())`,
      values: [this.scope.tenantId, this.scope.actorId, credential.role, credential.sessionVersion, credential.expiresAt],
    };
  }

  private ticketAccess(credential: ActivityPresentationCredential): SqlCondition {
    const authority = this.recipientAuthority(credential);
    return {
      sql: `${authority.sql} AND (t.group_id IS NULL OR ?='admin' OR EXISTS (
        SELECT 1 FROM user_groups ug WHERE ug.tenant_id=t.tenant_id AND ug.group_id=t.group_id AND ug.user_id=?
      ))`,
      values: [...authority.values, credential.role, this.scope.actorId],
    };
  }

  /** Validates a bounded trusted append and returns a statement safe to add to the canonical mutation batch. */
  async prepareTrustedAppend(input: TrustedActivityAppend): Promise<PreparedActivityAppend> {
    const immutable = await this.immutable(input);
    return { statement: this.appendStatement(immutable) };
  }

  /**
   * Direct-assignment activity is derived from the durable internal audit event,
   * not from the dashboard request. The caller places its event statement first
   * in the same canonical D1 batch; if that event was not accepted, this SELECT
   * inserts nothing.
   */
  async prepareAssignmentFromCanonicalEvent(input: Readonly<{
    id: string; ticketId: string; recipientUserId: string; eventId: string; producerId: string;
  }>): Promise<PreparedActivityAppend> {
    requireIdentifier(input.eventId, 'event id');
    const immutable = await this.immutable({
      id: input.id, ticketId: input.ticketId, recipientUserId: input.recipientUserId,
      kind: 'assignment', sourceId: `conversation:${input.eventId}`,
      producer: { kind: 'staff', id: input.producerId }, facts: { eventId: input.eventId },
    });
    return { statement: this.db.prepare(`INSERT INTO operator_activities
      (tenant_id,id,ticket_id,recipient_user_id,kind,source_id,producer_kind,producer_id,facts,receipt_fingerprint,resurfaced_at)
      SELECT e.tenant_id,?,?,?,?,?,?,?,?,?,?
      FROM conversation_events e
      WHERE e.tenant_id=? AND e.id=? AND e.ticket_id=?
        AND e.kind='ticket.assignment_changed' AND e.actor_kind='staff' AND e.actor_id=?
        AND e.actor_provenance='mfa-staff' AND e.source='dashboard' AND e.visibility='internal'
        AND json_extract(e.facts,'$.after.assignedTo')=?
        AND json_extract(e.facts,'$.before.assignedTo') IS NOT json_extract(e.facts,'$.after.assignedTo')
      ON CONFLICT (tenant_id,recipient_user_id,kind,source_id) DO NOTHING RETURNING ${columns}`)
      .bind(
        immutable.id, immutable.ticketId, immutable.recipientUserId, immutable.kind, immutable.sourceId,
        immutable.producerKind, immutable.producerId, immutable.facts, immutable.fingerprint, immutable.resurfacedAt,
        this.scope.tenantId, input.eventId, immutable.ticketId, input.producerId, immutable.recipientUserId,
      ) };
  }

  /**
   * Project a public, authenticated customer reply for the ticket's current
   * assigned operator. The assignment is read only to build the immutable
   * receipt; the INSERT rechecks it in the canonical batch so reassignment
   * between preparation and commit cannot notify the wrong recipient.
   */
  async prepareCustomerReplyFromCanonicalEvent(input: Readonly<{
    id: string; ticketId: string; articleId: string; eventId: string;
  }>): Promise<PreparedActivityAppend | null> {
    requireIdentifier(input.eventId, 'event id');
    requireIdentifier(input.articleId, 'article id');
    const ticket = await this.db.prepare(`SELECT assigned_to FROM tickets WHERE tenant_id=? AND id=?`)
      .bind(this.scope.tenantId, input.ticketId).first<{ assigned_to: string | null }>();
    const recipientUserId = ticket?.assigned_to;
    if (!recipientUserId) return null;
    requireIdentifier(recipientUserId, 'recipient user id');
    const immutable = await this.immutable({
      id: input.id, ticketId: input.ticketId, recipientUserId, kind: 'customer_reply',
      sourceId: `conversation:${input.eventId}`, producer: { kind: 'system' },
      facts: { articleId: input.articleId, eventId: input.eventId },
    });
    return { statement: this.db.prepare(`INSERT INTO operator_activities
      (tenant_id,id,ticket_id,recipient_user_id,kind,source_id,producer_kind,producer_id,facts,receipt_fingerprint,resurfaced_at)
      SELECT e.tenant_id,?,?,?,?,?,?,?,?,?,NULL
      FROM conversation_events e JOIN tickets t ON t.tenant_id=e.tenant_id AND t.id=e.ticket_id
      WHERE e.tenant_id=? AND e.id=? AND e.ticket_id=? AND e.article_id=?
        AND e.kind='message.reply' AND e.actor_kind='customer' AND e.actor_provenance='authenticated-customer'
        AND e.source IN ('portal','widget') AND e.visibility='public'
        AND t.assigned_to=? AND t.assigned_to IS NOT NULL
      ON CONFLICT (tenant_id,recipient_user_id,kind,source_id) DO NOTHING RETURNING ${columns}`)
      .bind(
        immutable.id, immutable.ticketId, immutable.recipientUserId, immutable.kind, immutable.sourceId,
        immutable.producerKind, immutable.producerId, immutable.facts, immutable.fingerprint,
        this.scope.tenantId, input.eventId, input.ticketId, input.articleId, recipientUserId,
      ) };
  }

  private appendStatement(immutable: ImmutableActivity): D1PreparedStatement {
    // The predicate is evaluated in the actual D1 batch. An earlier asynchronous
    // check cannot substitute for the ticket/recipient state at canonical commit.
    return this.db.prepare(`INSERT INTO operator_activities
      (tenant_id,id,ticket_id,recipient_user_id,kind,source_id,producer_kind,producer_id,facts,receipt_fingerprint,resurfaced_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT (tenant_id,recipient_user_id,kind,source_id) DO NOTHING RETURNING ${columns}`)
      .bind(
        this.scope.tenantId, immutable.id, immutable.ticketId, immutable.recipientUserId, immutable.kind, immutable.sourceId,
        immutable.producerKind, immutable.producerId, immutable.facts, immutable.fingerprint, immutable.resurfacedAt,
      );
  }

  /** Immediate append for bounded server-side work; replays return the same immutable row. */
  async appendTrusted(input: TrustedActivityAppend): Promise<Readonly<{ activity: OperatorActivity; idempotent: boolean }> | null> {
    const immutable = await this.immutable(input);
    let inserted: Row | null;
    try {
      inserted = await this.appendStatement(immutable).first<Row>();
    } catch (error) {
      if (String(error).includes('operator_activity_receipt_conflict')) throw new OperatorActivityConflictError();
      throw error;
    }
    if (inserted) return { activity: activityFromRow(inserted), idempotent: false };
    const existing = await this.db.prepare(`SELECT ${selectColumns} FROM operator_activities a
      JOIN tickets t ON t.tenant_id=a.tenant_id AND t.id=a.ticket_id
      JOIN users r ON r.tenant_id=a.tenant_id AND r.id=a.recipient_user_id
      WHERE a.tenant_id=? AND a.recipient_user_id=? AND a.kind=? AND a.source_id=?
        AND r.role IN ('admin','agent') AND (t.group_id IS NULL OR r.role='admin' OR EXISTS (
          SELECT 1 FROM user_groups ug WHERE ug.tenant_id=t.tenant_id AND ug.group_id=t.group_id AND ug.user_id=r.id
        ))`)
      .bind(this.scope.tenantId, immutable.recipientUserId, immutable.kind, immutable.sourceId).first<Row>();
    if (!existing) return null;
    if (!this.sameImmutable(existing, immutable)) throw new OperatorActivityConflictError();
    return { activity: activityFromRow(existing), idempotent: true };
  }

  async listForRecipient(options: Readonly<{ cursor?: string | null; limit: number }>, credential: ActivityPresentationCredential): Promise<OperatorActivityPage | null> {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > MAX_PAGE_SIZE) throw new Error('Invalid activity page size');
    if (!(await this.isLiveRecipient(credential))) return null;
    await this.cursorKey();
    const cursor = await this.decodeCursor(options.cursor);
    const access = this.ticketAccess(credential);
    // The tuple predicate seeks directly in the recipient index, including on
    // later pages. At most 100 candidates are authorized; the 101st is lookahead.
    const seek = cursor ? 'AND (a.created_at,a.id)<(?,?)' : '';
    const { results } = await this.db.prepare(`WITH candidates AS MATERIALIZED (
        SELECT a.* FROM operator_activities a WHERE a.tenant_id=? AND a.recipient_user_id=? ${seek}
        ORDER BY a.created_at DESC,a.id DESC LIMIT ?
      ), window AS MATERIALIZED (
        SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT ?
      ), visible AS (
        SELECT a.* FROM window a JOIN tickets t ON t.tenant_id=a.tenant_id AND t.id=a.ticket_id
        WHERE ${access.sql}
      )
      SELECT 'summary' AS row_kind,(SELECT count(*) FROM candidates) AS candidate_count,
        (SELECT id FROM window ORDER BY created_at,id LIMIT 1) AS id,
        NULL AS ticket_id,NULL AS recipient_user_id,NULL AS kind,NULL AS source_id,NULL AS producer_kind,
        NULL AS producer_id,NULL AS facts,NULL AS receipt_fingerprint,NULL AS revision,
        (SELECT created_at FROM window ORDER BY created_at,id LIMIT 1) AS created_at,
        NULL AS resurfaced_at,NULL AS read_at,NULL AS dismissed_at
      UNION ALL
      SELECT 'item',NULL,${selectColumns} FROM visible a
      ORDER BY row_kind DESC,created_at DESC,id DESC`)
      .bind(this.scope.tenantId, this.scope.actorId, ...(cursor ? [cursor.createdAt, cursor.id] : []),
        OPERATOR_ACTIVITY_CANDIDATE_LIMIT + 1, OPERATOR_ACTIVITY_CANDIDATE_LIMIT, ...access.values)
      .all<Row & { row_kind: 'summary' | 'item'; candidate_count: number | null }>();
    if (!(await this.isLiveRecipient(credential))) return null;
    const rows = results ?? [];
    const summary = rows.find(row => row.row_kind === 'summary');
    const visibleRows = rows.filter(row => row.row_kind === 'item');
    const items = visibleRows.slice(0, options.limit).map(activityFromRow);
    const last = items[items.length - 1];
    // Full visible pages resume after their last returned row. A sparse or empty
    // window resumes after its scanned boundary, encrypted so inaccessible row
    // identifiers/timestamps never leave the server in a readable cursor.
    const boundary = visibleRows.length > options.limit && last ? { createdAt: last.createdAt, id: last.id }
      : (summary?.candidate_count ?? 0) > OPERATOR_ACTIVITY_CANDIDATE_LIMIT && summary
        ? { createdAt: summary.created_at, id: summary.id } : null;
    return { status: 'available', items, next: boundary ? await this.encodeCursor(boundary, credential) : null };
  }

  async unreadCount(credential: ActivityPresentationCredential): Promise<OperatorActivityUnreadCount | null> {
    const access = this.ticketAccess(credential);
    if (!(await this.isLiveRecipient(credential))) return null;
    const row = await this.db.prepare(`WITH candidates AS MATERIALIZED (
        SELECT a.tenant_id,a.ticket_id FROM operator_activities a
        WHERE a.tenant_id=? AND a.recipient_user_id=? AND a.read_at IS NULL AND a.dismissed_at IS NULL
        ORDER BY a.created_at DESC,a.id DESC LIMIT ?
      ), visible AS (
        SELECT 1 FROM candidates a JOIN tickets t ON t.tenant_id=a.tenant_id AND t.id=a.ticket_id WHERE ${access.sql}
      ) SELECT (SELECT count(*) FROM candidates) AS candidate_count,(SELECT count(*) FROM visible) AS visible_count`)
      .bind(this.scope.tenantId, this.scope.actorId, OPERATOR_ACTIVITY_CANDIDATE_LIMIT + 1, ...access.values)
      .first<{ candidate_count: number; visible_count: number }>();
    if (!(await this.isLiveRecipient(credential))) return null;
    if ((row?.candidate_count ?? 0) > OPERATOR_ACTIVITY_CANDIDATE_LIMIT) {
      return { status: 'unavailable', reason: 'recipient_activity_candidate_cap_exceeded', count: null };
    }
    return { status: 'available', count: row?.visible_count ?? 0 };
  }

  async markRead(id: string, expectedRevision: number, credential: ActivityPresentationCredential): Promise<OperatorActivity | null> {
    return this.transition(id, expectedRevision, credential, 'read');
  }

  async dismiss(id: string, expectedRevision: number, credential: ActivityPresentationCredential): Promise<OperatorActivity | null> {
    return this.transition(id, expectedRevision, credential, 'dismiss');
  }

  private async transition(id: string, expectedRevision: number, credential: ActivityPresentationCredential, action: 'read' | 'dismiss'): Promise<OperatorActivity | null> {
    requireIdentifier(id, 'id');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('Invalid activity revision');
    const access = this.ticketAccess(credential);
    const set = action === 'read' ? "read_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')" : "dismissed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')";
    const state = action === 'read' ? 'operator_activities.read_at IS NULL AND operator_activities.dismissed_at IS NULL' : 'operator_activities.dismissed_at IS NULL';
    const row = await this.db.prepare(`UPDATE operator_activities SET ${set},revision=revision+1
      WHERE tenant_id=? AND recipient_user_id=? AND id=? AND revision=? AND ${state}
        AND ${this.ticketForMutationSql(credential, access.sql)}
      RETURNING ${columns}`)
      .bind(this.scope.tenantId, this.scope.actorId, id, expectedRevision, ...access.values).first<Row>();
    return row ? activityFromRow(row) : null;
  }

  private ticketForMutationSql(_credential: ActivityPresentationCredential, accessSql: string): string {
    return `EXISTS (SELECT 1 FROM tickets t WHERE t.tenant_id=operator_activities.tenant_id
      AND t.id=operator_activities.ticket_id AND ${accessSql})`;
  }

  private async isLiveRecipient(credential: ActivityPresentationCredential): Promise<boolean> {
    const authority = this.recipientAuthority(credential);
    const row = await this.db.prepare(`SELECT 1 AS ok WHERE ${authority.sql}`).bind(...authority.values).first<{ ok: number }>();
    return row?.ok === 1;
  }

  private sameImmutable(row: Row, value: ImmutableActivity): boolean {
    return row.receipt_fingerprint === value.fingerprint;
  }

  private async immutable(input: TrustedActivityAppend): Promise<ImmutableActivity> {
    requireIdentifier(input.id, 'id');
    requireIdentifier(input.ticketId, 'ticket id');
    requireIdentifier(input.recipientUserId, 'recipient id');
    requireIdentifier(input.sourceId, 'source id');
    if (!OPERATOR_ACTIVITY_KINDS.includes(input.kind)) throw new Error('Invalid activity kind');
    if (input.producer.kind === 'staff') requireIdentifier(input.producer.id, 'producer id');
    const value = {
      id: input.id, ticketId: input.ticketId, recipientUserId: input.recipientUserId, kind: input.kind,
      sourceId: input.sourceId, producerKind: input.producer.kind,
      producerId: input.producer.kind === 'staff' ? input.producer.id : null,
      facts: canonicalFacts(input.facts), resurfacedAt: validTimestamp(input.resurfacedAt),
    };
    return { ...value, fingerprint: await fingerprint(value) };
  }
}
