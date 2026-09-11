import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import { costPolicySchema, effectiveTenantPolicy } from '../utils/cost-policy';
import {
  type TrustedBudgetCoordinatorAuthority,
  type TrustedBudgetCoordinatorRevocation,
  type TrustedTenantAllocation,
} from './owner-aggregate';

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

export type BudgetAuthorityResolution =
  | Readonly<{ kind: 'active'; authority: TrustedBudgetCoordinatorAuthority }>
  | Readonly<{ kind: 'revoked'; revocation: TrustedBudgetCoordinatorRevocation }>
  | Readonly<{ kind: 'unavailable' }>;

function currentTime(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('budget authority time must be a non-negative safe integer');
}

function parseJson(value: string, name: string): unknown {
  try { return JSON.parse(value); }
  catch { throw new Error(`${name} contains invalid JSON`); }
}

/**
 * Reads only deployment-owned budget authority. The verified scope is checked
 * against the current users row before any allocation is returned. IDs and
 * JSON supplied to this class are database records, never request authority.
 */
export class BudgetAuthorityRepository {
  constructor(private readonly db: D1Database) {}

  private async liveMembership(scope: VerifiedTenantScope): Promise<boolean> {
    const membership = await this.db.prepare(`SELECT role,session_version FROM users
      WHERE tenant_id=? AND id=? LIMIT 1`).bind(scope.tenantId, scope.actorId).first();
    return !!membership && typeof membership.role === 'string' && scope.roles.includes(membership.role)
      && Number.isSafeInteger(membership.session_version) && membership.session_version === scope.authVersion;
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
      ORDER BY a.tenant_id ASC LIMIT 129`).bind(row.deployment_id, row.policy_id, row.policy_revision, row.authority_revision, row.coordinator_id),
      this.db.prepare(`SELECT count(*) AS count FROM budget_tenant_allocations a
        JOIN budget_owner_policies p ON p.deployment_id=a.deployment_id AND p.policy_id=a.policy_id
          AND p.policy_revision=a.policy_revision AND p.authority_revision=a.authority_revision
        JOIN budget_deployment_authority d ON d.deployment_id=a.deployment_id
        WHERE a.deployment_id=? AND a.policy_id=? AND a.policy_revision=? AND a.authority_revision=?
          AND a.state='active' AND p.coordinator_id=? AND d.state='active'
          AND d.authority_revision=? AND p.max_reservations=? AND p.authority_max_age_ms=?`)
        .bind(row.deployment_id, row.policy_id, row.policy_revision, row.authority_revision, row.coordinator_id,
          row.authority_revision, row.max_reservations, row.authority_max_age_ms),
    ];
    const [rows, snapshot] = await this.db.batch(statements) as [D1Result<{ tenant_id: string; reservation_namespace: string; restriction_json: string; policy_json: string }>, D1Result<{ count: number }>];
    const count = snapshot.results[0]?.count;
    if (rows.results.length < 1 || rows.results.length > 128 || count !== rows.results.length) throw new Error('budget authority snapshot changed or has an invalid number of tenant allocations');
    return rows.results.map(tenant => ({
      reservationNamespace: tenant.reservation_namespace,
      effectivePolicy: effectiveTenantPolicy(parseJson(tenant.policy_json, 'owner policy'), parseJson(tenant.restriction_json, 'tenant restriction'), tenant.tenant_id),
    }));
  }

  /**
   * A revoked allocation returns only a server-derived coordinator revocation.
   * Missing/malformed authority fails closed and never authorizes a reservation.
   */
  async resolveForVerifiedScope(scope: VerifiedTenantScope, now: number): Promise<BudgetAuthorityResolution> {
    currentTime(now);
    try {
      if (!await this.liveMembership(scope)) return { kind: 'unavailable' };
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
      return {
        kind: 'active',
        authority: {
          aggregateId: row.coordinator_id,
          ownerPolicy,
          tenantAllocations,
          authorityCheckedAt: now,
          authorityRevision: row.authority_revision,
          authorityExpiresAt: now + row.authority_max_age_ms,
          maxReservations: row.max_reservations,
        },
      };
    } catch {
      return { kind: 'unavailable' };
    }
  }
}
