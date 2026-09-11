import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import { capabilityWriteConstraint, type CapabilityWriteFence } from '../auth/capability-policy';
import type { LocalBetaAdmissionRepository } from './local-beta-admission.repository';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../utils/encoding';
import type { ConversationActor } from '../types/conversation-audit';
import type {
  SupportStateDeactivation,
  SupportStateDefinition,
  SupportStateDefinitionInput,
  SupportStateDefinitionUpdate,
  SupportStateTransition,
  TicketSupportState,
} from '../types/support-state';

const categories = new Set(['open', 'pending', 'resolved', 'closed']);
const uuidSql = "lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))";
const compatibilityDefaults = [
  ['legacy-open', 'open', 'Open'],
  ['legacy-pending', 'pending', 'Pending'],
  ['legacy-resolved', 'resolved', 'Resolved'],
  ['legacy-closed', 'closed', 'Closed'],
] as const;
const supportStateCursorVersion = 1;
const maxSupportStateCursorLength = 1024;
// Policies are created only when a tenant first needs a clock. Calendar is
// deliberately the approved 24/7 UTC baseline; target durations remain NULL
// until an administrator configures them.
const defaultSlaCalendarJson = JSON.stringify({
  timeZone: 'UTC',
  weekly: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, [{ startMinute: 0, endMinute: 1440 }]])),
  exceptions: [],
  dst: { ambiguousLocalTime: 'earlier', nonexistentLocalTime: 'next-valid' },
});

function encodeSupportStateCursor(value: { compatibility: number; label: string; id: string }): string {
  return arrayBufferToBase64(new TextEncoder().encode(JSON.stringify({ v: supportStateCursorVersion, ...value })))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeSupportStateCursor(value: string): { compatibility: number; label: string; id: string } {
  try {
    if (value.length > maxSupportStateCursorLength || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid');
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    const decoded = JSON.parse(new TextDecoder().decode(base64ToArrayBuffer(padded))) as Record<string, unknown>;
    if (decoded.v !== supportStateCursorVersion || !Number.isInteger(decoded.compatibility) ||
      (decoded.compatibility !== 0 && decoded.compatibility !== 1) || typeof decoded.label !== 'string' ||
      typeof decoded.id !== 'string' || !decoded.label || !decoded.id || decoded.label.length > 120 || decoded.id.length > 120) throw new Error('invalid');
    return { compatibility: decoded.compatibility, label: decoded.label, id: decoded.id };
  } catch { throw new SupportStateError('invalid', 'Invalid support-state cursor'); }
}

export class SupportStateError extends Error {
  constructor(public readonly code: 'invalid' | 'not_found' | 'conflict', message: string) { super(message); }
}

export type TicketStateWriteFence = Readonly<{
  tenantId: string;
  actorId: string;
  role: 'admin' | 'agent';
  sessionVersion: number;
}>;

function ticketWriteConstraint(fence: TicketStateWriteFence, ticketAlias: string): { sql: string; values: unknown[] } {
  return {
    sql: `EXISTS (SELECT 1 FROM users actor WHERE actor.tenant_id=${ticketAlias}.tenant_id
      AND actor.id=? AND actor.role=? AND actor.session_version=?
      AND (actor.role <> 'agent' OR ${ticketAlias}.group_id IS NULL OR EXISTS (
        SELECT 1 FROM user_groups membership WHERE membership.tenant_id=${ticketAlias}.tenant_id
          AND membership.user_id=actor.id AND membership.group_id=${ticketAlias}.group_id)))`,
    values: [fence.actorId, fence.role, fence.sessionVersion],
  };
}

function boundedText(value: string | null | undefined, maximum: number, required = false): string | null {
  if (value === undefined || value === null) {
    if (required) throw new SupportStateError('invalid', 'Required support-state fact is missing');
    return null;
  }
  const trimmed = value.trim();
  if ((!trimmed && required) || !trimmed || new TextEncoder().encode(trimmed).byteLength > maximum) {
    throw new SupportStateError('invalid', 'Invalid support-state text');
  }
  return trimmed;
}

function actorValues(actor: ConversationActor) {
  if (actor.kind !== 'staff') throw new SupportStateError('invalid', 'Support-state administration requires a staff actor');
  return [actor.kind, actor.id] as const;
}

/**
 * Tenant-scoped state storage. Mutation callers must pass an already
 * authenticated staff actor; this repository never accepts a client tenant id.
 */
export class SupportStateRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope, private readonly admission?: LocalBetaAdmissionRepository) {}

  private defaultStatements(): D1PreparedStatement[] {
    return compatibilityDefaults.map(([id, status, label]) => this.db.prepare(
      `INSERT OR IGNORE INTO support_state_definitions
        (tenant_id,id,legacy_status,internal_label,public_label,is_compatibility_default)
       VALUES (?,?,?,?,?,1)`,
    ).bind(this.scope.tenantId, id, status, label, label));
  }

  async ensureDefaults(): Promise<void> {
    await this.db.batch(this.defaultStatements());
  }

  async listDefinitions(limit: number, includeInactive = false): Promise<SupportStateDefinition[]> {
    return (await this.listDefinitionsPage(limit, undefined, includeInactive)).results;
  }

  async listDefinitionsPage(limit: number, cursor?: string, includeInactive = false): Promise<{ results: SupportStateDefinition[]; nextCursor: string | null }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new SupportStateError('invalid', 'Invalid support-state page');
    const decoded = cursor ? decodeSupportStateCursor(cursor) : null;
    const active = includeInactive ? '' : 'AND is_active=1';
    const after = decoded ? `AND (is_compatibility_default < ? OR (is_compatibility_default = ? AND
      (internal_label COLLATE NOCASE > ? OR (internal_label COLLATE NOCASE = ? AND id > ?))))` : '';
    const values = decoded
      ? [this.scope.tenantId, decoded.compatibility, decoded.compatibility, decoded.label, decoded.label, decoded.id]
      : [this.scope.tenantId];
    const result = await this.db.prepare(`SELECT * FROM support_state_definitions
      WHERE tenant_id=? ${active} ${after} ORDER BY is_compatibility_default DESC, internal_label COLLATE NOCASE, id LIMIT ?`)
      .bind(...values, limit + 1).all<SupportStateDefinition>();
    const hasMore = result.results.length > limit;
    const results = result.results.slice(0, limit);
    const last = results.at(-1);
    return { results, nextCursor: hasMore && last
      ? encodeSupportStateCursor({ compatibility: last.is_compatibility_default, label: last.internal_label, id: last.id }) : null };
  }

  async getDefinition(id: string, includeInactive = false): Promise<SupportStateDefinition | null> {
    return this.db.prepare(`SELECT * FROM support_state_definitions WHERE tenant_id=? AND id=?
      ${includeInactive ? '' : 'AND is_active=1'}`).bind(this.scope.tenantId, id).first<SupportStateDefinition>();
  }

  async getTicketState(ticketId: string): Promise<TicketSupportState | null> {
    return this.db.prepare(`SELECT s.ticket_id,s.definition_id,d.legacy_status AS lifecycle,
      d.internal_label,d.public_label,s.waiting_reason,s.next_action,s.changed_at,s.revision
      FROM ticket_support_state s JOIN support_state_definitions d
        ON d.tenant_id=s.tenant_id AND d.id=s.definition_id
      WHERE s.tenant_id=? AND s.ticket_id=?`).bind(this.scope.tenantId, ticketId).first<TicketSupportState>();
  }

  async countReferences(definitionId: string): Promise<number> {
    const page = await this.db.prepare(`SELECT ticket_id FROM ticket_support_state
      WHERE tenant_id=? AND definition_id=? ORDER BY ticket_id COLLATE BINARY LIMIT 101`)
      .bind(this.scope.tenantId, definitionId).all<{ ticket_id: string }>();
    return page.results.length;
  }

  async captureTicketWriteFence(expectedSessionVersion?: number): Promise<TicketStateWriteFence> {
    const actor = await this.db.prepare('SELECT role,session_version FROM users WHERE tenant_id=? AND id=?')
      .bind(this.scope.tenantId, this.scope.actorId).first<{ role: string; session_version: number }>();
    if (!actor || (actor.role !== 'admin' && actor.role !== 'agent') || !this.scope.roles.includes(actor.role)
      || (expectedSessionVersion !== undefined && actor.session_version !== expectedSessionVersion)) {
      throw new SupportStateError('not_found', 'Ticket not found');
    }
    return { tenantId: this.scope.tenantId, actorId: this.scope.actorId, role: actor.role,
      sessionVersion: expectedSessionVersion ?? actor.session_version };
  }

  async createDefinition(input: SupportStateDefinitionInput, actor: ConversationActor, fence?: CapabilityWriteFence): Promise<SupportStateDefinition> {
    const [actorKind, actorId] = actorValues(actor);
    const id = boundedText(input.id, 120, true)!;
    if (!/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(id) || id.startsWith('legacy-') || !categories.has(input.legacyStatus)) {
      throw new SupportStateError('invalid', 'Invalid support-state definition');
    }
    const internalLabel = boundedText(input.internalLabel, 120, true)!;
    const publicLabel = boundedText(input.publicLabel, 120, true)!;
    const waitingRequired = input.waitingReasonRequired ? 1 : 0;
    const actionRequired = input.nextActionRequired ? 1 : 0;
    const guard = capabilityWriteConstraint(fence);
    const results = await this.db.batch<SupportStateDefinition>([
      ...compatibilityDefaults.map(([defaultId, status, label]) => this.db.prepare(`INSERT OR IGNORE INTO support_state_definitions
        (tenant_id,id,legacy_status,internal_label,public_label,is_compatibility_default)
        SELECT ?,?,?,?,?,1 WHERE ${guard.sql}`).bind(this.scope.tenantId, defaultId, status, label, label, ...guard.values)),
      this.db.prepare(`INSERT INTO support_state_definitions
        (tenant_id,id,legacy_status,internal_label,public_label,waiting_reason_required,next_action_required)
        SELECT ?,?,?,?,?,?,? WHERE ${guard.sql} RETURNING *`).bind(this.scope.tenantId,id,input.legacyStatus,internalLabel,publicLabel,waitingRequired,actionRequired,...guard.values),
      this.db.prepare(`INSERT INTO support_state_events
        (tenant_id,id,definition_id,kind,actor_kind,actor_id,facts)
        SELECT ?,${uuidSql},id,'definition.created',?,?,json_object(
          'lifecycle',legacy_status,'internalLabel',internal_label,'publicLabel',public_label,
          'waitingReasonRequired',waiting_reason_required,'nextActionRequired',next_action_required)
        FROM support_state_definitions WHERE tenant_id=? AND id=? AND ${guard.sql}`)
        .bind(this.scope.tenantId,actorKind,actorId,this.scope.tenantId,id,...guard.values),
    ]);
    const created = results[compatibilityDefaults.length]?.results?.[0];
    if (!created) throw new SupportStateError('conflict', 'Support-state definition was not created');
    return created;
  }

  async updateDefinition(id: string, input: SupportStateDefinitionUpdate, actor: ConversationActor, fence?: CapabilityWriteFence): Promise<SupportStateDefinition> {
    const [actorKind, actorId] = actorValues(actor);
    const sets: string[] = [];
    const values: (string | number)[] = [];
    if (input.internalLabel !== undefined) { sets.push('internal_label=?'); values.push(boundedText(input.internalLabel, 120, true)!); }
    if (input.publicLabel !== undefined) { sets.push('public_label=?'); values.push(boundedText(input.publicLabel, 120, true)!); }
    if (input.waitingReasonRequired !== undefined) { sets.push('waiting_reason_required=?'); values.push(input.waitingReasonRequired ? 1 : 0); }
    if (input.nextActionRequired !== undefined) { sets.push('next_action_required=?'); values.push(input.nextActionRequired ? 1 : 0); }
    if (!sets.length) throw new SupportStateError('invalid', 'No support-state definition fields supplied');
    const guard = capabilityWriteConstraint(fence);
    const results = await this.db.batch<SupportStateDefinition>([
      this.db.prepare(`UPDATE support_state_definitions SET ${sets.join(',')},updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE tenant_id=? AND id=? AND is_compatibility_default=0 AND ${guard.sql} RETURNING *`).bind(...values,this.scope.tenantId,id,...guard.values),
      this.db.prepare(`INSERT INTO support_state_events
        (tenant_id,id,definition_id,kind,actor_kind,actor_id,facts)
        SELECT ?,${uuidSql},id,'definition.updated',?,?,json_object(
          'lifecycle',legacy_status,'internalLabel',internal_label,'publicLabel',public_label,
          'waitingReasonRequired',waiting_reason_required,'nextActionRequired',next_action_required)
        FROM support_state_definitions WHERE tenant_id=? AND id=? AND is_compatibility_default=0 AND ${guard.sql}`)
        .bind(this.scope.tenantId,actorKind,actorId,this.scope.tenantId,id,...guard.values),
    ]);
    const updated = results[0]?.results?.[0];
    if (!updated) throw new SupportStateError('not_found', 'Support-state definition was not updated');
    return updated;
  }

  async transition(ticketId: string, input: SupportStateTransition, actor: ConversationActor, fence: TicketStateWriteFence): Promise<TicketSupportState> {
    const [actorKind, actorId] = actorValues(actor);
    const waitingReason = boundedText(input.waitingReason, 512);
    const nextAction = boundedText(input.nextAction, 512);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !input.definitionId) throw new SupportStateError('invalid', 'A support-state compare-and-swap value is required');
    const token = crypto.randomUUID();
    const live = ticketWriteConstraint(fence, 't');
    const liveTicket = ticketWriteConstraint(fence, 'tickets');
    const validTarget = `EXISTS (SELECT 1 FROM support_state_definitions d WHERE d.tenant_id=s.tenant_id AND d.id=?
      AND d.is_active=1 AND (d.waiting_reason_required=0 OR ? IS NOT NULL) AND (d.next_action_required=0 OR ? IS NOT NULL))`;
    const sameChange = '(s.definition_id IS NOT ? OR s.waiting_reason IS NOT ? OR s.next_action IS NOT ?)';
    const beforeAfter = `json_object('before',json_object('definitionId',s.definition_id,'waitingReason',s.waiting_reason,'nextAction',s.next_action),
      'after',json_object('definitionId',d.id,'lifecycle',d.legacy_status,'waitingReason',?,'nextAction',?))`;
    const eventWhere = `t.tenant_id=? AND t.id=? AND s.revision=? AND ${sameChange} AND ${validTarget} AND ${live.sql}`;
    const admission = this.admission?.conditionalConversationStatements({
      sql: `EXISTS (SELECT 1 FROM tickets t JOIN ticket_support_state s ON s.tenant_id=t.tenant_id AND s.ticket_id=t.id
        WHERE ${eventWhere})`,
      values: [this.scope.tenantId,ticketId,input.expectedRevision,input.definitionId,waitingReason,nextAction,input.definitionId,waitingReason,nextAction,...live.values],
    }) ?? [];
    const results = await this.db.batch<TicketSupportState>([
      ...admission,
      this.db.prepare(`INSERT INTO support_state_events
        (tenant_id,id,ticket_id,definition_id,kind,actor_kind,actor_id,facts)
        SELECT t.tenant_id,${uuidSql},t.id,d.id,'ticket.transition',?,?,${beforeAfter}
        FROM tickets t JOIN ticket_support_state s ON s.tenant_id=t.tenant_id AND s.ticket_id=t.id
        JOIN support_state_definitions d ON d.tenant_id=s.tenant_id AND d.id=? WHERE ${eventWhere}`)
        .bind(actorKind,actorId,waitingReason,nextAction,input.definitionId,this.scope.tenantId,ticketId,input.expectedRevision,input.definitionId,waitingReason,nextAction,input.definitionId,waitingReason,nextAction,...live.values),
      this.db.prepare(`INSERT INTO conversation_events
        (tenant_id,id,ticket_id,article_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts)
        SELECT t.tenant_id,${uuidSql},t.id,NULL,(SELECT COALESCE(MAX(e.sequence),0)+1 FROM conversation_events e WHERE e.tenant_id=t.tenant_id AND e.ticket_id=t.id),
          'ticket.state_changed',?,?, 'mfa-staff','dashboard','internal',${beforeAfter}
        FROM tickets t JOIN ticket_support_state s ON s.tenant_id=t.tenant_id AND s.ticket_id=t.id
        JOIN support_state_definitions d ON d.tenant_id=s.tenant_id AND d.id=? WHERE ${eventWhere}`)
        .bind(actorKind,actorId,waitingReason,nextAction,input.definitionId,this.scope.tenantId,ticketId,input.expectedRevision,input.definitionId,waitingReason,nextAction,input.definitionId,waitingReason,nextAction,...live.values),
      this.db.prepare(`UPDATE ticket_support_state AS s SET definition_id=?,waiting_reason=?,next_action=?,
        changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revision=revision+1,transition_token=?
        WHERE s.tenant_id=? AND s.ticket_id=? AND s.revision=? AND ${sameChange} AND ${validTarget}
          AND EXISTS (SELECT 1 FROM tickets t WHERE t.tenant_id=s.tenant_id AND t.id=s.ticket_id AND ${live.sql}) RETURNING ticket_id`)
        .bind(input.definitionId,waitingReason,nextAction,token,this.scope.tenantId,ticketId,input.expectedRevision,input.definitionId,waitingReason,nextAction,input.definitionId,waitingReason,nextAction,...live.values),
      this.db.prepare(`UPDATE tickets SET status=(SELECT legacy_status FROM support_state_definitions WHERE tenant_id=? AND id=?)
        WHERE tenant_id=? AND id=? AND ${liveTicket.sql} AND EXISTS (SELECT 1 FROM ticket_support_state s WHERE s.tenant_id=tickets.tenant_id AND s.ticket_id=tickets.id AND s.transition_token=?)`)
        .bind(this.scope.tenantId,input.definitionId,this.scope.tenantId,ticketId,...liveTicket.values,token),
      this.db.prepare(`UPDATE ticket_support_state SET transition_token=NULL WHERE tenant_id=? AND ticket_id=? AND transition_token=?
        AND EXISTS (SELECT 1 FROM tickets t WHERE t.tenant_id=ticket_support_state.tenant_id AND t.id=ticket_support_state.ticket_id AND ${live.sql})`)
        .bind(this.scope.tenantId,ticketId,token,...live.values),
      this.db.prepare(`SELECT s.ticket_id,s.definition_id,d.legacy_status AS lifecycle,d.internal_label,d.public_label,
        s.waiting_reason,s.next_action,s.changed_at,s.revision FROM ticket_support_state s JOIN support_state_definitions d
        ON d.tenant_id=s.tenant_id AND d.id=s.definition_id WHERE s.tenant_id=? AND s.ticket_id=?`).bind(this.scope.tenantId,ticketId),
      // Every SLA write is fenced by the just-advanced support-state revision.
      // A stale compare-and-swap therefore cannot create a policy, clock, or
      // audit record even though D1 batch statements are evaluated in order.
      this.db.prepare(`INSERT OR IGNORE INTO sla_policies
        (tenant_id,calendar_json,response_target_ms,resolution_target_ms,response_reopen_policy,resolution_reopen_policy)
        SELECT ?,?,NULL,NULL,'continue','continue' WHERE EXISTS (
          SELECT 1 FROM tickets t JOIN ticket_support_state s ON s.tenant_id=t.tenant_id AND s.ticket_id=t.id
          WHERE t.tenant_id=? AND t.id=? AND s.revision=? AND ${live.sql}
        )`).bind(this.scope.tenantId,defaultSlaCalendarJson,this.scope.tenantId,ticketId,input.expectedRevision + 1,...live.values),
      this.db.prepare(`INSERT INTO ticket_sla_events
        (tenant_id,id,ticket_id,kind,support_state_revision,actor_id,facts)
        SELECT t.tenant_id,${uuidSql},t.id,
          CASE
            WHEN c.ticket_id IS NULL THEN 'clock.initialized'
            WHEN d.legacy_status='pending' AND s.waiting_reason IS NOT NULL AND c.paused_at IS NULL THEN 'clock.paused'
            WHEN NOT (d.legacy_status='pending' AND s.waiting_reason IS NOT NULL) AND c.paused_at IS NOT NULL THEN 'clock.resumed'
            WHEN d.legacy_status IN ('resolved','closed') AND c.resolution_completed_at IS NULL THEN 'clock.resolved'
            WHEN d.legacy_status NOT IN ('resolved','closed') AND c.resolution_completed_at IS NOT NULL THEN 'clock.reopened'
          END,
          s.revision,?,json_object('lifecycle',d.legacy_status,'waiting',d.legacy_status='pending' AND s.waiting_reason IS NOT NULL)
        FROM tickets t JOIN ticket_support_state s ON s.tenant_id=t.tenant_id AND s.ticket_id=t.id
        JOIN support_state_definitions d ON d.tenant_id=s.tenant_id AND d.id=s.definition_id
        LEFT JOIN ticket_sla_clocks c ON c.tenant_id=t.tenant_id AND c.ticket_id=t.id
        WHERE t.tenant_id=? AND t.id=? AND s.revision=? AND ${live.sql}
          AND (c.ticket_id IS NULL
            OR (d.legacy_status='pending' AND s.waiting_reason IS NOT NULL) IS NOT (c.paused_at IS NOT NULL)
            OR (d.legacy_status IN ('resolved','closed')) IS NOT (c.resolution_completed_at IS NOT NULL))`)
        .bind(actorId,this.scope.tenantId,ticketId,input.expectedRevision + 1,...live.values),
      this.db.prepare(`INSERT INTO ticket_sla_pause_intervals (tenant_id,ticket_id,started_at,reason,support_state_revision)
        SELECT t.tenant_id,t.id,s.changed_at,'waiting',s.revision
        FROM tickets t JOIN ticket_support_state s ON s.tenant_id=t.tenant_id AND s.ticket_id=t.id
        JOIN support_state_definitions d ON d.tenant_id=s.tenant_id AND d.id=s.definition_id
        LEFT JOIN ticket_sla_clocks c ON c.tenant_id=t.tenant_id AND c.ticket_id=t.id
        WHERE t.tenant_id=? AND t.id=? AND s.revision=? AND d.legacy_status='pending' AND s.waiting_reason IS NOT NULL
          AND (c.ticket_id IS NULL OR c.paused_at IS NULL) AND ${live.sql}`)
        .bind(this.scope.tenantId,ticketId,input.expectedRevision + 1,...live.values),
      this.db.prepare(`UPDATE ticket_sla_pause_intervals SET ended_at=(
          SELECT s.changed_at FROM ticket_support_state s WHERE s.tenant_id=ticket_sla_pause_intervals.tenant_id AND s.ticket_id=ticket_sla_pause_intervals.ticket_id)
        WHERE tenant_id=? AND ticket_id=? AND ended_at IS NULL AND EXISTS (
          SELECT 1 FROM tickets t JOIN ticket_support_state s ON s.tenant_id=t.tenant_id AND s.ticket_id=t.id
          JOIN support_state_definitions d ON d.tenant_id=s.tenant_id AND d.id=s.definition_id
          WHERE t.tenant_id=? AND t.id=? AND s.revision=? AND NOT (d.legacy_status='pending' AND s.waiting_reason IS NOT NULL) AND ${live.sql}
        )`).bind(this.scope.tenantId,ticketId,this.scope.tenantId,ticketId,input.expectedRevision + 1,...live.values),
      this.db.prepare(`INSERT INTO ticket_sla_clocks
        (tenant_id,ticket_id,response_started_at,resolution_started_at,resolution_completed_at,paused_at,pause_reason,last_support_state_revision,
         policy_revision,policy_calendar_json,policy_response_target_ms,policy_resolution_target_ms,policy_response_reopen_policy,policy_resolution_reopen_policy)
        SELECT t.tenant_id,t.id,t.created_at,t.created_at,
          CASE WHEN d.legacy_status IN ('resolved','closed') THEN s.changed_at ELSE NULL END,
          CASE WHEN d.legacy_status='pending' AND s.waiting_reason IS NOT NULL THEN s.changed_at ELSE NULL END,
          CASE WHEN d.legacy_status='pending' AND s.waiting_reason IS NOT NULL THEN 'waiting' ELSE NULL END,s.revision,
          p.revision,p.calendar_json,p.response_target_ms,p.resolution_target_ms,p.response_reopen_policy,p.resolution_reopen_policy
        FROM tickets t JOIN ticket_support_state s ON s.tenant_id=t.tenant_id AND s.ticket_id=t.id
        JOIN support_state_definitions d ON d.tenant_id=s.tenant_id AND d.id=s.definition_id
        JOIN sla_policies p ON p.tenant_id=t.tenant_id
        WHERE t.tenant_id=? AND t.id=? AND s.revision=? AND ${live.sql}
        ON CONFLICT(tenant_id,ticket_id) DO UPDATE SET
          response_started_at=CASE WHEN excluded.resolution_completed_at IS NULL AND ticket_sla_clocks.resolution_completed_at IS NOT NULL
            AND ticket_sla_clocks.policy_response_reopen_policy='restart'
            THEN (SELECT changed_at FROM ticket_support_state s WHERE s.tenant_id=ticket_sla_clocks.tenant_id AND s.ticket_id=ticket_sla_clocks.ticket_id)
            ELSE ticket_sla_clocks.response_started_at END,
          response_completed_at=CASE WHEN excluded.resolution_completed_at IS NULL AND ticket_sla_clocks.resolution_completed_at IS NOT NULL
            AND ticket_sla_clocks.policy_response_reopen_policy='restart' THEN NULL
            ELSE ticket_sla_clocks.response_completed_at END,
          resolution_started_at=CASE WHEN excluded.resolution_completed_at IS NULL AND ticket_sla_clocks.resolution_completed_at IS NOT NULL
            AND ticket_sla_clocks.policy_resolution_reopen_policy='restart'
            THEN (SELECT changed_at FROM ticket_support_state s WHERE s.tenant_id=ticket_sla_clocks.tenant_id AND s.ticket_id=ticket_sla_clocks.ticket_id)
            ELSE ticket_sla_clocks.resolution_started_at END,
          resolution_completed_at=CASE
            WHEN excluded.resolution_completed_at IS NOT NULL THEN COALESCE(ticket_sla_clocks.resolution_completed_at,excluded.resolution_completed_at)
            ELSE NULL END,
          paused_at=excluded.paused_at,pause_reason=excluded.pause_reason,
          last_support_state_revision=excluded.last_support_state_revision,revision=ticket_sla_clocks.revision+1,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
        .bind(this.scope.tenantId,ticketId,input.expectedRevision + 1,...live.values),
    ]);
    const offset = admission.length;
    if (!results[offset + 2]?.results?.[0]) throw new SupportStateError('conflict', 'Support-state transition conflicted or was invalid');
    const state = results[offset + 5]?.results?.[0];
    if (!state) throw new SupportStateError('conflict', 'Support-state transition result unavailable');
    return state;
  }

  async deactivate(id: string, input: SupportStateDeactivation, actor: ConversationActor, fence?: CapabilityWriteFence): Promise<void> {
    const [actorKind, actorId] = actorValues(actor);
    if (!input.replacementId || input.replacementId === id) throw new SupportStateError('invalid', 'A distinct replacement state is required');
    const waitingReason = boundedText(input.waitingReason, 512);
    const nextAction = boundedText(input.nextAction, 512);
    const token = crypto.randomUUID();
    const guard = capabilityWriteConstraint(fence);
    // Every remap statement consumes the same in-batch 101-row sentinel. The
    // admitted path keeps the first current-session/capability/group fence
    // authoritative, then intersects it with that cap without repeating the
    // full authorization predicate once per remapped ticket.
    const batchGuard = fence
      ? 'EXISTS (SELECT 1 FROM budget_mutation_assertion a WHERE a.tenant_id=? AND a.accepted=1)'
      : `${guard.sql} AND EXISTS (SELECT 1 FROM budget_mutation_assertion a WHERE a.tenant_id=? AND a.accepted=1)`;
    const batchGuardValues = fence ? [this.scope.tenantId] : [...guard.values, this.scope.tenantId];
    const admittedFence = fence ? 'AND EXISTS (SELECT 1 FROM budget_mutation_assertion a WHERE a.tenant_id=? AND a.accepted=1)' : '';
    const admittedFenceValues = fence ? [this.scope.tenantId] : [];
    const target = `EXISTS (SELECT 1 FROM support_state_definitions d WHERE d.tenant_id=s.tenant_id AND d.id=? AND d.is_active=1
      AND (d.waiting_reason_required=0 OR ? IS NOT NULL) AND (d.next_action_required=0 OR ? IS NOT NULL))`;
    const definitionTarget = `EXISTS (SELECT 1 FROM support_state_definitions d WHERE d.tenant_id=o.tenant_id AND d.id=? AND d.is_active=1
      AND (d.waiting_reason_required=0 OR ? IS NOT NULL) AND (d.next_action_required=0 OR ? IS NOT NULL))`;
    const old = `EXISTS (SELECT 1 FROM support_state_definitions o WHERE o.tenant_id=s.tenant_id AND o.id=? AND o.is_active=1 AND o.is_compatibility_default=0)`;
    const facts = `json_object('before',json_object('definitionId',s.definition_id,'waitingReason',s.waiting_reason,'nextAction',s.next_action),
      'after',json_object('definitionId',d.id,'lifecycle',d.legacy_status,'waitingReason',?,'nextAction',?),'reason','definition_deactivated')`;
    const rows = `t.tenant_id=? AND s.definition_id=? AND ${old} AND ${target} AND ${batchGuard}`;
    const candidates = `SELECT ticket_id FROM ticket_support_state
      WHERE tenant_id=? AND definition_id=? ORDER BY ticket_id COLLATE BINARY LIMIT 101`;
    const results = await this.db.batch([
      // The service's count is advisory. The same 101-row indexed sentinel is
      // evaluated inside the batch, preventing a concurrent remap from
      // expanding the supported 100-ticket operation.
      this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
        VALUES (?,CASE WHEN (SELECT count(*) FROM (${candidates}))<=100 ${admittedFence} THEN 1 ELSE 0 END)
        ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`)
        .bind(this.scope.tenantId,this.scope.tenantId,id,...admittedFenceValues),
      this.db.prepare(`INSERT INTO support_state_events (tenant_id,id,ticket_id,definition_id,kind,actor_kind,actor_id,facts)
        SELECT t.tenant_id,${uuidSql},t.id,d.id,'ticket.transition',?,?,${facts}
        FROM tickets t JOIN ticket_support_state s ON s.tenant_id=t.tenant_id AND s.ticket_id=t.id
        JOIN support_state_definitions d ON d.tenant_id=s.tenant_id AND d.id=? WHERE ${rows}`)
        .bind(actorKind,actorId,waitingReason,nextAction,input.replacementId,this.scope.tenantId,id,id,input.replacementId,waitingReason,nextAction,...batchGuardValues),
      this.db.prepare(`INSERT INTO conversation_events
        (tenant_id,id,ticket_id,article_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts)
        SELECT t.tenant_id,${uuidSql},t.id,NULL,(SELECT COALESCE(MAX(e.sequence),0)+1 FROM conversation_events e WHERE e.tenant_id=t.tenant_id AND e.ticket_id=t.id),
          'ticket.state_changed',?,?, 'mfa-staff','dashboard','internal',${facts}
        FROM tickets t JOIN ticket_support_state s ON s.tenant_id=t.tenant_id AND s.ticket_id=t.id
        JOIN support_state_definitions d ON d.tenant_id=s.tenant_id AND d.id=? WHERE ${rows}`)
        .bind(actorKind,actorId,waitingReason,nextAction,input.replacementId,this.scope.tenantId,id,id,input.replacementId,waitingReason,nextAction,...batchGuardValues),
      this.db.prepare(`UPDATE ticket_support_state AS s SET definition_id=?,waiting_reason=?,next_action=?,
        changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revision=revision+1,transition_token=? WHERE s.tenant_id=? AND s.definition_id=? AND ${old} AND ${target} AND ${batchGuard}`)
        .bind(input.replacementId,waitingReason,nextAction,token,this.scope.tenantId,id,id,input.replacementId,waitingReason,nextAction,...batchGuardValues),
      this.db.prepare(`UPDATE tickets SET status=(SELECT legacy_status FROM support_state_definitions WHERE tenant_id=? AND id=?)
        WHERE tenant_id=? AND id IN (SELECT ticket_id FROM ticket_support_state
          WHERE tenant_id=? AND transition_token=?) AND ${batchGuard}`)
        .bind(this.scope.tenantId,input.replacementId,this.scope.tenantId,this.scope.tenantId,token,...batchGuardValues),
      // Preserve the same SLA projection and audit composition as a regular
      // support-state transition, but restrict every statement to the
      // token-marked remap candidates.
      this.db.prepare(`INSERT OR IGNORE INTO sla_policies
        (tenant_id,calendar_json,response_target_ms,resolution_target_ms,response_reopen_policy,resolution_reopen_policy)
        SELECT ?,?,NULL,NULL,'continue','continue' WHERE EXISTS (
          SELECT 1 FROM ticket_support_state s WHERE s.tenant_id=? AND s.transition_token=? AND ${batchGuard}
        )`).bind(this.scope.tenantId,defaultSlaCalendarJson,this.scope.tenantId,token,...batchGuardValues),
      this.db.prepare(`INSERT INTO ticket_sla_events
        (tenant_id,id,ticket_id,kind,support_state_revision,actor_id,facts)
        SELECT t.tenant_id,${uuidSql},t.id,
          CASE
            WHEN c.ticket_id IS NULL THEN 'clock.initialized'
            WHEN d.legacy_status='pending' AND s.waiting_reason IS NOT NULL AND c.paused_at IS NULL THEN 'clock.paused'
            WHEN NOT (d.legacy_status='pending' AND s.waiting_reason IS NOT NULL) AND c.paused_at IS NOT NULL THEN 'clock.resumed'
            WHEN d.legacy_status IN ('resolved','closed') AND c.resolution_completed_at IS NULL THEN 'clock.resolved'
            WHEN d.legacy_status NOT IN ('resolved','closed') AND c.resolution_completed_at IS NOT NULL THEN 'clock.reopened'
          END,
          s.revision,?,json_object('lifecycle',d.legacy_status,'waiting',d.legacy_status='pending' AND s.waiting_reason IS NOT NULL)
        FROM ticket_support_state s JOIN tickets t ON t.tenant_id=s.tenant_id AND t.id=s.ticket_id
        JOIN support_state_definitions d ON d.tenant_id=s.tenant_id AND d.id=s.definition_id
        LEFT JOIN ticket_sla_clocks c ON c.tenant_id=t.tenant_id AND c.ticket_id=t.id
        WHERE s.tenant_id=? AND s.transition_token=? AND ${batchGuard}
          AND (c.ticket_id IS NULL
            OR (d.legacy_status='pending' AND s.waiting_reason IS NOT NULL) IS NOT (c.paused_at IS NOT NULL)
            OR (d.legacy_status IN ('resolved','closed')) IS NOT (c.resolution_completed_at IS NOT NULL))`)
        .bind(actorId,this.scope.tenantId,token,...batchGuardValues),
      this.db.prepare(`INSERT INTO ticket_sla_pause_intervals (tenant_id,ticket_id,started_at,reason,support_state_revision)
        SELECT t.tenant_id,t.id,s.changed_at,'waiting',s.revision
        FROM ticket_support_state s JOIN tickets t ON t.tenant_id=s.tenant_id AND t.id=s.ticket_id
        JOIN support_state_definitions d ON d.tenant_id=s.tenant_id AND d.id=s.definition_id
        LEFT JOIN ticket_sla_clocks c ON c.tenant_id=t.tenant_id AND c.ticket_id=t.id
        WHERE s.tenant_id=? AND s.transition_token=? AND d.legacy_status='pending' AND s.waiting_reason IS NOT NULL
          AND (c.ticket_id IS NULL OR c.paused_at IS NULL) AND ${batchGuard}`)
        .bind(this.scope.tenantId,token,...batchGuardValues),
      this.db.prepare(`UPDATE ticket_sla_pause_intervals SET ended_at=(
          SELECT s.changed_at FROM ticket_support_state s WHERE s.tenant_id=ticket_sla_pause_intervals.tenant_id
            AND s.ticket_id=ticket_sla_pause_intervals.ticket_id AND s.transition_token=?)
        WHERE tenant_id=? AND ended_at IS NULL AND ticket_id IN (
          SELECT s.ticket_id FROM ticket_support_state s JOIN support_state_definitions d
            ON d.tenant_id=s.tenant_id AND d.id=s.definition_id
          WHERE s.tenant_id=? AND s.transition_token=? AND NOT (d.legacy_status='pending' AND s.waiting_reason IS NOT NULL)
        ) AND ${batchGuard}`)
        .bind(token,this.scope.tenantId,this.scope.tenantId,token,...batchGuardValues),
      this.db.prepare(`INSERT INTO ticket_sla_clocks
        (tenant_id,ticket_id,response_started_at,resolution_started_at,resolution_completed_at,paused_at,pause_reason,last_support_state_revision,
         policy_revision,policy_calendar_json,policy_response_target_ms,policy_resolution_target_ms,policy_response_reopen_policy,policy_resolution_reopen_policy)
        SELECT t.tenant_id,t.id,t.created_at,t.created_at,
          CASE WHEN d.legacy_status IN ('resolved','closed') THEN s.changed_at ELSE NULL END,
          CASE WHEN d.legacy_status='pending' AND s.waiting_reason IS NOT NULL THEN s.changed_at ELSE NULL END,
          CASE WHEN d.legacy_status='pending' AND s.waiting_reason IS NOT NULL THEN 'waiting' ELSE NULL END,s.revision,
          p.revision,p.calendar_json,p.response_target_ms,p.resolution_target_ms,p.response_reopen_policy,p.resolution_reopen_policy
        FROM ticket_support_state s JOIN tickets t ON t.tenant_id=s.tenant_id AND t.id=s.ticket_id
        JOIN support_state_definitions d ON d.tenant_id=s.tenant_id AND d.id=s.definition_id
        JOIN sla_policies p ON p.tenant_id=t.tenant_id
        WHERE s.tenant_id=? AND s.transition_token=? AND ${batchGuard}
        ON CONFLICT(tenant_id,ticket_id) DO UPDATE SET
          response_started_at=CASE WHEN excluded.resolution_completed_at IS NULL AND ticket_sla_clocks.resolution_completed_at IS NOT NULL
            AND ticket_sla_clocks.policy_response_reopen_policy='restart'
            THEN (SELECT changed_at FROM ticket_support_state s WHERE s.tenant_id=ticket_sla_clocks.tenant_id AND s.ticket_id=ticket_sla_clocks.ticket_id)
            ELSE ticket_sla_clocks.response_started_at END,
          response_completed_at=CASE WHEN excluded.resolution_completed_at IS NULL AND ticket_sla_clocks.resolution_completed_at IS NOT NULL
            AND ticket_sla_clocks.policy_response_reopen_policy='restart' THEN NULL
            ELSE ticket_sla_clocks.response_completed_at END,
          resolution_started_at=CASE WHEN excluded.resolution_completed_at IS NULL AND ticket_sla_clocks.resolution_completed_at IS NOT NULL
            AND ticket_sla_clocks.policy_resolution_reopen_policy='restart'
            THEN (SELECT changed_at FROM ticket_support_state s WHERE s.tenant_id=ticket_sla_clocks.tenant_id AND s.ticket_id=ticket_sla_clocks.ticket_id)
            ELSE ticket_sla_clocks.resolution_started_at END,
          resolution_completed_at=CASE WHEN excluded.resolution_completed_at IS NOT NULL THEN COALESCE(ticket_sla_clocks.resolution_completed_at,excluded.resolution_completed_at)
            ELSE NULL END,
          paused_at=excluded.paused_at,pause_reason=excluded.pause_reason,
          last_support_state_revision=excluded.last_support_state_revision,revision=ticket_sla_clocks.revision+1,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
        .bind(this.scope.tenantId,token,...batchGuardValues),
      this.db.prepare(`UPDATE ticket_support_state SET transition_token=NULL WHERE tenant_id=?
        AND ticket_id IN (SELECT ticket_id FROM ticket_support_state WHERE tenant_id=? AND transition_token=?) AND ${batchGuard}`)
        .bind(this.scope.tenantId,this.scope.tenantId,token,...batchGuardValues),
      this.db.prepare(`INSERT INTO support_state_events (tenant_id,id,definition_id,kind,actor_kind,actor_id,facts)
        SELECT ?,${uuidSql},id,'definition.deactivated',?,?,json_object('replacementId',?)
        FROM support_state_definitions o WHERE o.tenant_id=? AND o.id=? AND o.is_compatibility_default=0 AND o.is_active=1
          AND ${definitionTarget} AND ${batchGuard}`)
        .bind(this.scope.tenantId,actorKind,actorId,input.replacementId,this.scope.tenantId,id,input.replacementId,waitingReason,nextAction,...batchGuardValues),
      this.db.prepare(`UPDATE support_state_definitions AS o SET is_active=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE o.tenant_id=? AND o.id=? AND o.is_compatibility_default=0 AND o.is_active=1
          AND ${definitionTarget} AND ${batchGuard} RETURNING id`)
        .bind(this.scope.tenantId,id,input.replacementId,waitingReason,nextAction,...batchGuardValues),
    ]);
    if (!results[12]?.results?.[0]) throw new SupportStateError('conflict', 'Support-state deactivation conflicted or was invalid');
  }
}
