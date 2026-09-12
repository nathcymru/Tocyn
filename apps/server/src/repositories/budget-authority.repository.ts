import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import { costPolicySchema, effectiveTenantPolicy } from '../utils/cost-policy';
import {
  type TrustedBudgetCoordinatorAuthority,
  type TrustedBudgetCoordinatorRevocation,
  type TrustedTenantAllocation,
} from '../budgets/owner-aggregate';

type AuthorityRow = Readonly<{
  deployment_id: string;
  authority_revision: number;
  authority_state: 'active' | 'revoked';
  coordinator_id: string;
  max_reservations: number;
  authority_max_age_ms: number;
  policy_id: string;
  policy_revision: number;
  policy_json: string;
  tenant_id: string;
  reservation_namespace: string;
  restriction_json: string;
  allocation_state: 'active' | 'revoked';
}>;

export type BudgetAuthorityPrincipal =
  | Readonly<{ kind: 'session'; sessionVersion: number }>
  | Readonly<{ kind: 'api-key'; apiKeyId: string; requiredPermission: string }>
  | Readonly<{ kind: 'widget'; widgetKey: string }>
  /** Trusted workflow composition only; never constructed from a request. */
  | Readonly<{ kind: 'system'; actor: 'vectorize-workflow' | 'scheduled-retention' | 'knowledge-delete' }>;

export const BUDGET_AUTHORITY_MAX_TENANT_ALLOCATIONS = 128 as const;
/** Each coherent snapshot statement stops after this sentinel; a matching index bounds its candidate scan. */
export const BUDGET_AUTHORITY_SNAPSHOT_SENTINEL = BUDGET_AUTHORITY_MAX_TENANT_ALLOCATIONS + 1;
/** Two indexed snapshot statements can each visit at most 129 allocation rows and their joined policy rows. */
export const BUDGET_AUTHORITY_SNAPSHOT_D1_READ_BOUND = 1_024 as const;
/** Bound D1 policy parsing and DO RPC payloads before a large configured snapshot can consume an unbounded request. */
export const BUDGET_AUTHORITY_MAX_JSON_BYTES = 64 * 1024;
export const BUDGET_AUTHORITY_MAX_SERIALIZED_BYTES = 96 * 1024;

/** Exact bounded source rows used by admission; staff commits compare them atomically. */
export type BudgetCommitSnapshot = Readonly<Pick<AuthorityRow,
  'deployment_id' | 'authority_revision' | 'coordinator_id' | 'max_reservations' | 'authority_max_age_ms' |
  'policy_id' | 'policy_revision' | 'policy_json' | 'tenant_id' | 'reservation_namespace' | 'restriction_json'>>;

export type BudgetAuthorityResolution =
  | Readonly<{ kind: 'active'; authority: TrustedBudgetCoordinatorAuthority; commitSnapshot: BudgetCommitSnapshot }>
  | Readonly<{ kind: 'revoked'; revocation: TrustedBudgetCoordinatorRevocation }>
  | Readonly<{ kind: 'unavailable' }>;

function currentTime(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('budget authority time must be a non-negative safe integer');
}

function parseJson(value: string, name: string): unknown {
  if (new TextEncoder().encode(value).byteLength > BUDGET_AUTHORITY_MAX_JSON_BYTES) throw new Error(`${name} exceeds the bounded authority JSON size`);
  try { return JSON.parse(value); }
  catch { throw new Error(`${name} contains invalid JSON`); }
}

/**
 * Reads deployment-owned authority only after a current credential principal.
 * The coherent allocation snapshot uses two indexed, sentinel-bounded queries:
 * no statement counts or sorts an unbounded allocation set. IDs and JSON are
 * database records, never request authority.
 */
export class BudgetAuthorityRepository {
  constructor(private readonly db: D1Database, private readonly boundScope?: VerifiedTenantScope,
    /** Opaque stable cache context from trusted composition, never a storage API for callers. */
    readonly bindingIdentity: object = db) {}

  async authorizeApiKeyTicket(scope: VerifiedTenantScope, tenantId: string, apiKeyId: string): Promise<BudgetAuthorityPrincipal | null> {
    return this.authorizeApiKeyTicketPermission(scope, tenantId, apiKeyId, 'tickets:write');
  }

  /**
   * History is an independently admitted read path.  Keep its live-key check
   * distinct from the mutation adapter so a read-only key is never forced
   * through a write permission contract.
   */
  async authorizeApiKeyTicketRead(scope: VerifiedTenantScope, tenantId: string, apiKeyId: string): Promise<BudgetAuthorityPrincipal | null> {
    return this.authorizeApiKeyTicketPermission(scope, tenantId, apiKeyId, 'tickets:read');
  }

  private async authorizeApiKeyTicketPermission(scope: VerifiedTenantScope, tenantId: string, apiKeyId: string,
    requiredPermission: 'tickets:read' | 'tickets:write'): Promise<BudgetAuthorityPrincipal | null> {
    if (scope.tenantId !== tenantId || scope.actorId !== apiKeyId || !scope.roles.includes('integration')
      || (this.boundScope && (this.boundScope.tenantId !== scope.tenantId || this.boundScope.actorId !== scope.actorId))) return null;
    const principal = { kind: 'api-key' as const, apiKeyId, requiredPermission };
    return await this.livePrincipal(scope, principal) ? principal : null;
  }

  private async livePrincipal(scope: VerifiedTenantScope, principal: BudgetAuthorityPrincipal): Promise<boolean> {
    if (principal.kind === 'widget') {
      if (scope.actorId !== 'widget-anonymous' || !scope.roles.includes('customer') || principal.widgetKey.length < 1 || principal.widgetKey.length > 256) return false;
      const current = await this.db.prepare("SELECT 1 AS active FROM tenant_config WHERE tenant_id=? AND key='widget.public_key' AND value=? LIMIT 1")
        .bind(scope.tenantId, principal.widgetKey).first<{ active: number }>();
      return current?.active === 1;
    }
    if (principal.kind === 'session') {
      const membership = await this.db.prepare(`SELECT role,session_version FROM users
        WHERE tenant_id=? AND id=? LIMIT 1`).bind(scope.tenantId, scope.actorId).first();
      return !!membership && typeof membership.role === 'string' && scope.roles.includes(membership.role)
        && Number.isSafeInteger(membership.session_version) && membership.session_version === scope.authVersion
        && membership.session_version === principal.sessionVersion;
    }
    if (principal.kind === 'system') return scope.roles.includes('system') && scope.actorId === principal.actor;
    if (!scope.roles.includes('integration') || scope.actorId !== principal.apiKeyId) return false;
    const key = await this.db.prepare(`SELECT permissions FROM api_keys
      WHERE tenant_id=? AND id=? AND is_active=1 LIMIT 1`).bind(scope.tenantId, principal.apiKeyId).first<{ permissions: string }>();
    return !!key && typeof key.permissions === 'string'
      && key.permissions.split(',').map(permission => permission.trim()).includes(principal.requiredPermission);
  }

  private async requestedAllocation(tenantId: string): Promise<AuthorityRow | null> {
    return this.db.prepare(`SELECT d.deployment_id,d.authority_revision,d.state AS authority_state,
      p.coordinator_id,p.max_reservations,p.authority_max_age_ms,p.policy_id,p.policy_revision,p.policy_json,
      a.tenant_id,a.reservation_namespace,a.restriction_json,a.state AS allocation_state
      FROM budget_tenant_allocations a
      JOIN budget_owner_policies p ON p.deployment_id=a.deployment_id AND p.policy_id=a.policy_id
        AND p.policy_revision=a.policy_revision AND p.authority_revision=a.authority_revision
      JOIN budget_deployment_authority d ON d.deployment_id=a.deployment_id
      WHERE a.tenant_id=?`).bind(tenantId).first<AuthorityRow>();
  }

  private async activeTenants(row: AuthorityRow): Promise<readonly TrustedTenantAllocation[]> {
    const statements = [this.db.prepare(`SELECT a.tenant_id,a.reservation_namespace,a.restriction_json,p.policy_json
      FROM budget_tenant_allocations a
      JOIN budget_owner_policies p ON p.deployment_id=a.deployment_id AND p.policy_id=a.policy_id
        AND p.policy_revision=a.policy_revision AND p.authority_revision=a.authority_revision
      JOIN budget_deployment_authority d ON d.deployment_id=a.deployment_id
      WHERE a.deployment_id=? AND a.policy_id=? AND a.policy_revision=? AND a.authority_revision=? AND a.state='active'
        AND p.coordinator_id=?
        AND d.state='active' AND d.authority_revision=a.authority_revision
      LIMIT ${BUDGET_AUTHORITY_SNAPSHOT_SENTINEL}`).bind(row.deployment_id, row.policy_id, row.policy_revision, row.authority_revision, row.coordinator_id),
      this.db.prepare(`SELECT count(*) AS count FROM (
        SELECT 1 FROM budget_tenant_allocations a
        JOIN budget_owner_policies p ON p.deployment_id=a.deployment_id AND p.policy_id=a.policy_id
          AND p.policy_revision=a.policy_revision AND p.authority_revision=a.authority_revision
        JOIN budget_deployment_authority d ON d.deployment_id=a.deployment_id
        WHERE a.deployment_id=? AND a.policy_id=? AND a.policy_revision=? AND a.authority_revision=?
          AND a.state='active' AND p.coordinator_id=? AND d.state='active'
          AND d.authority_revision=? AND p.max_reservations=? AND p.authority_max_age_ms=?
        LIMIT ${BUDGET_AUTHORITY_SNAPSHOT_SENTINEL}
      )`)
        .bind(row.deployment_id, row.policy_id, row.policy_revision, row.authority_revision, row.coordinator_id,
          row.authority_revision, row.max_reservations, row.authority_max_age_ms),
    ];
    const [rows, snapshot] = await this.db.batch(statements) as [D1Result<{ tenant_id: string; reservation_namespace: string; restriction_json: string; policy_json: string }>, D1Result<{ count: number }>];
    const count = snapshot.results[0]?.count;
    if (rows.results.length < 1 || rows.results.length > BUDGET_AUTHORITY_MAX_TENANT_ALLOCATIONS || count !== rows.results.length) throw new Error('budget authority snapshot changed or has an invalid number of tenant allocations');
    return [...rows.results].sort((left, right) => left.tenant_id.localeCompare(right.tenant_id)).map(tenant => ({
      reservationNamespace: tenant.reservation_namespace,
      effectivePolicy: effectiveTenantPolicy(parseJson(tenant.policy_json, 'owner policy'), parseJson(tenant.restriction_json, 'tenant restriction'), tenant.tenant_id),
    }));
  }

  /**
   * A revoked allocation returns only a server-derived coordinator revocation.
   * Missing/malformed authority fails closed and never authorizes a reservation.
   */
  async resolveForVerifiedPrincipal(scope: VerifiedTenantScope, principal: BudgetAuthorityPrincipal, now: number): Promise<BudgetAuthorityResolution> {
    currentTime(now);
    if (this.boundScope && (this.boundScope.tenantId !== scope.tenantId || this.boundScope.actorId !== scope.actorId)) return { kind: 'unavailable' };
    try {
      if (!await this.livePrincipal(scope, principal)) return { kind: 'unavailable' };
      const row = await this.requestedAllocation(scope.tenantId);
      if (!row) return { kind: 'unavailable' };
      if (row.authority_state !== 'active' || row.allocation_state !== 'active') {
        return { kind: 'revoked', revocation: { aggregateId: row.coordinator_id, authorityRevision: row.authority_revision, authorityCheckedAt: now } };
      }
      const ownerPolicy = costPolicySchema.parse(parseJson(row.policy_json, 'owner policy'));
      if (!Number.isSafeInteger(row.authority_max_age_ms) || row.authority_max_age_ms < 1
        || row.authority_max_age_ms > ownerPolicy.maxGrantLifetimeMs
        || now > Number.MAX_SAFE_INTEGER - row.authority_max_age_ms) return { kind: 'unavailable' };
      const tenantAllocations = await this.activeTenants(row);
      const own = tenantAllocations.find(tenant => tenant.effectivePolicy.tenantId === scope.tenantId);
      if (!own) return { kind: 'unavailable' };
      const authority: TrustedBudgetCoordinatorAuthority = {
        aggregateId: row.coordinator_id,
        ownerPolicy,
        tenantAllocations,
        authorityCheckedAt: now,
        authorityRevision: row.authority_revision,
        authorityExpiresAt: now + row.authority_max_age_ms,
        maxReservations: row.max_reservations,
      };
      if (new TextEncoder().encode(JSON.stringify(authority)).byteLength > BUDGET_AUTHORITY_MAX_SERIALIZED_BYTES) return { kind: 'unavailable' };
      return { kind: 'active', authority, commitSnapshot: Object.freeze({ ...row }) };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  /** Compatibility for verified user-session callers; API keys must use the explicit principal method. */
  async resolveForVerifiedScope(scope: VerifiedTenantScope, now: number): Promise<BudgetAuthorityResolution> {
    return this.resolveForVerifiedPrincipal(scope, { kind: 'session', sessionVersion: scope.authVersion }, now);
  }
}
