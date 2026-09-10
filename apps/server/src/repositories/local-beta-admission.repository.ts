import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { Ticket } from '../types';
import type { VerifiedTenantScope } from '../types/tenant';
import {
  BetaAdmissionError, type BetaOperation, type BetaPolicy, type BetaPrincipal, type BetaCredential,
} from '../types/local-beta';

type TicketChange = Partial<Pick<Ticket, 'status' | 'priority' | 'assigned_to' | 'group_id' | 'custom_fields'>>;
type ChangePredicate = { sql: string; values: unknown[] };
const policyProjection = `p.run_id,p.revision,p.state,r.ticket_limit,r.mutation_limit,
  r.recovery_reserve,r.upload_limit,r.tickets,r.mutations,r.upload_attempts`;
const validPolicy = `(SELECT count(*) FROM local_beta_tenants t WHERE t.run_id=p.run_id)=2`;
const invited = `EXISTS (SELECT 1 FROM local_beta_invitations i
  WHERE i.run_id=p.run_id AND i.tenant_id=? AND i.principal_kind=? AND i.principal_id=?)`;

/** Deployment policy is not caller-selectable; tenant identity comes only from verified composition. */
export class LocalBetaAdmissionRepository {
  constructor(
    private db: D1Database,
    private scope: VerifiedTenantScope,
    private principal: BetaPrincipal,
    private credential?: BetaCredential,
  ) {}

  private livePrincipal(write: boolean) {
    const values: (string | number)[] = [this.scope.tenantId, this.principal.id];
    if (this.principal.kind === 'api-key') {
      const permission = write
        ? " AND instr(','||replace(k.permissions,' ','')||',',',tickets:write,')>0"
        : '';
      return {
        sql: `EXISTS (SELECT 1 FROM api_keys k
          WHERE k.tenant_id=? AND k.id=? AND k.is_active=1${permission})`,
        values,
      };
    }
    const role = this.principal.kind === 'customer' ? "u.role='customer'" : "u.role IN ('admin','agent')";
    let session = '';
    if (this.credential) {
      session = ' AND u.session_version=? AND ? > unixepoch()';
      values.push(this.credential.sessionVersion, this.credential.expiresAt);
    }
    return {
      sql: `EXISTS (SELECT 1 FROM users u WHERE u.tenant_id=? AND u.id=? AND ${role}${session})`,
      values,
    };
  }

  /** Advisory read; hard write authority is evaluated again within the mutation batch. */
  async authorize(operation?: BetaOperation): Promise<BetaPolicy> {
    const live = this.livePrincipal(Boolean(operation));
    let row: (BetaPolicy & { valid: number; invited: number }) | null;
    try {
      row = await this.db.prepare(`SELECT ${policyProjection},(${validPolicy}) AS valid,
        (${invited} AND ${live.sql}) AS invited
        FROM local_beta_policy p JOIN local_beta_runs r ON r.run_id=p.run_id WHERE p.singleton=1`)
        .bind(this.scope.tenantId, this.principal.kind, this.principal.id, ...live.values).first();
    } catch {
      throw new BetaAdmissionError('beta_admission_unavailable', 503);
    }
    if (!row || row.valid !== 1) throw new BetaAdmissionError('beta_admission_unavailable', 503);
    if (row.invited !== 1) throw new BetaAdmissionError('beta_not_invited', 403);
    if (!operation) return row;

    const stopped = row.state === 'writes_stopped'
      || (row.state === 'intake_stopped' && operation !== 'conversation');
    if (stopped) throw new BetaAdmissionError('beta_intake_stopped', 503);
    if (operation === 'upload') {
      if (row.upload_attempts >= row.upload_limit) throw new BetaAdmissionError('beta_upload_limit', 429);
    } else {
      const intakeFull = operation === 'create'
        && (row.tickets >= row.ticket_limit || row.mutations >= row.mutation_limit - row.recovery_reserve);
      if (row.mutations >= row.mutation_limit || intakeFull) {
        throw new BetaAdmissionError('beta_mutation_limit', 429);
      }
    }
    return row;
  }

  /** The owning mutation repository prepends these fixed statements to its atomic batch. */
  statements(operation: BetaOperation): readonly D1PreparedStatement[] {
    return this.buildStatements(operation);
  }

  /** The fixed null-safe predicate sees the same pre-mutation ticket as the audit events. */
  ticketChangeStatements(ticketId: string, data: TicketChange): readonly D1PreparedStatement[] {
    const keys = (['status', 'priority', 'assigned_to', 'group_id', 'custom_fields'] as const)
      .filter(key => data[key] !== undefined);
    const values = keys.map(key => {
      if (key === 'custom_fields' && data[key] !== null && typeof data[key] !== 'string') {
        return JSON.stringify(data[key]);
      }
      return data[key] ?? null;
    });
    const changedFields = keys.map(key => `t.${key} IS NOT ?`).join(' OR ');
    const change = {
      sql: keys.length
        ? `EXISTS (SELECT 1 FROM tickets t WHERE t.tenant_id=? AND t.id=? AND (${changedFields}))`
        : '0',
      values: keys.length ? [this.scope.tenantId, ticketId, ...values] : [],
    };
    return this.buildStatements('conversation', change);
  }

  /** Trusted repositories supply a batch-local predicate so stale CAS writes never consume capacity. */
  conditionalConversationStatements(change: Readonly<ChangePredicate>): readonly D1PreparedStatement[] {
    return this.buildStatements('conversation', { sql: change.sql, values: [...change.values] });
  }

  private buildStatements(operation: BetaOperation, change?: ChangePredicate): readonly D1PreparedStatement[] {
    if (this.scope.actorId !== this.principal.id) throw new BetaAdmissionError('beta_not_invited', 403);
    const live = this.livePrincipal(true);
    const capacity = operation === 'upload' ? 'r.upload_attempts < r.upload_limit'
      : operation === 'create' ? 'r.tickets < r.ticket_limit AND r.mutations < r.mutation_limit-r.recovery_reserve'
      : 'r.mutations < r.mutation_limit';
    const state = operation === 'conversation' ? "p.state IN ('running','intake_stopped')" : "p.state='running'";
    // No-op changes still require current invitation/credentials, but consume no capacity.
    const chargeAllowed = change
      ? `(NOT (${change.sql}) OR (${state} AND ${capacity}))`
      : `(${state} AND ${capacity})`;
    const assertion = this.db.prepare(`INSERT INTO local_beta_assertion(singleton,accepted)
      VALUES (1,COALESCE((SELECT CASE
        WHEN ${validPolicy} AND ${invited} AND ${live.sql} AND ${chargeAllowed} THEN 1 ELSE 0 END
        FROM local_beta_policy p JOIN local_beta_runs r ON r.run_id=p.run_id WHERE p.singleton=1),0))
      ON CONFLICT(singleton) DO UPDATE SET accepted=excluded.accepted`)
      .bind(this.scope.tenantId, this.principal.kind, this.principal.id, ...live.values, ...(change?.values ?? []));
    const increment = operation === 'upload' ? 'upload_attempts=upload_attempts+1'
      : operation === 'create' ? 'tickets=tickets+1,mutations=mutations+1' : 'mutations=mutations+1';
    const counter = this.db.prepare(`UPDATE local_beta_runs SET ${increment}
      WHERE run_id=(SELECT run_id FROM local_beta_policy WHERE singleton=1)${change ? ` AND ${change.sql}` : ''}`)
      .bind(...(change?.values ?? []));
    return [assertion, counter];
  }

  /** R2 is outside D1: attempts are durable before storage and intentionally never refunded. */
  async chargeUploadAttempt(): Promise<void> {
    try {
      await this.db.batch([...this.statements('upload')]);
    } catch {
      await this.authorize('upload');
      throw new BetaAdmissionError('beta_admission_unavailable', 503);
    }
  }
}
