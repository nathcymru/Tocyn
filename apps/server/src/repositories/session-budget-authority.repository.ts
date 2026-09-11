import type { D1Database } from '@cloudflare/workers-types';
import { resolveCapability, type CapabilityWriteFence } from '../auth/capability-policy';
import type { VerifiedTenantScope } from '../types/tenant';
import type { BudgetAuthorityPrincipal } from './budget-authority.repository';

export const MAX_SESSION_BUDGET_GROUPS = 64;
/** Estimated gate allowance within the existing 1,536-row warm credential/authority envelope. */
export const SESSION_BUDGET_CREDENTIAL_D1_READ_BOUND = 512;
export const SESSION_BUDGET_GROUP_CAPABILITY_SQL = `SELECT membership.group_id,constraint_row.enabled,constraint_row.revision
  FROM (SELECT group_id FROM user_groups WHERE tenant_id=? AND user_id=? ORDER BY group_id COLLATE BINARY LIMIT ${MAX_SESSION_BUDGET_GROUPS + 1}) membership
  LEFT JOIN tenant_group_capability_constraints constraint_row
    ON constraint_row.tenant_id=? AND constraint_row.group_id=membership.group_id AND constraint_row.capability=?
  ORDER BY membership.group_id COLLATE BINARY`;
/** Verified token facts, copied by trusted composition; never parsed from a request body. */
export type SessionBudgetCredential = Readonly<{
  tenantId: string; actorId: string; role: 'admin' | 'agent'; sessionVersion: number; expiresAt: number; mfaVerified: boolean;
}>;
export type SessionBudgetRequirements = Readonly<{
  /** Exact current target/group captured by canonical authorization. */
  ticket?: Readonly<{ id: string; groupId: string | null }>;
  /** Resolve the current ticket group during read admission, before content access. */
  readTicketId?: string;
  /** Optional existing capability fence; omitted for routes without a catalogue capability. */
  capability?: CapabilityWriteFence;
  /** Authentication entrypoints may carry a verified challenge/enrollment
   * credential before MFA is complete. Omission retains the active-MFA gate. */
  authentication?: 'challenge' | 'enrollment';
}>;

/** Bounded live session gate for server-selected prepaid work, separate from budget policy authority. */
export class SessionBudgetAuthorityRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  async authorize(credential: SessionBudgetCredential, requirements: SessionBudgetRequirements, now: number): Promise<BudgetAuthorityPrincipal | null> {
    if (credential.tenantId !== this.scope.tenantId || credential.actorId !== this.scope.actorId
      || !['admin', 'agent'].includes(credential.role) || !this.scope.roles.includes(credential.role)
      || !Number.isSafeInteger(credential.sessionVersion) || credential.sessionVersion !== this.scope.authVersion
      || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(credential.expiresAt)
      || credential.expiresAt <= now / 1_000
      || (requirements.authentication === 'challenge' ? credential.mfaVerified !== false
        : requirements.authentication === 'enrollment' ? typeof credential.mfaVerified !== 'boolean'
        : credential.mfaVerified !== true)) return null;
    const user = await this.db.prepare(`SELECT role,session_version,mfa_enabled FROM users WHERE tenant_id=? AND id=? LIMIT 1`)
      .bind(this.scope.tenantId, this.scope.actorId).first<{ role: string; session_version: number; mfa_enabled: number | boolean }>();
    if (!user || user.role !== credential.role || user.session_version !== credential.sessionVersion
      || (!requirements.authentication && user.mfa_enabled !== 1 && user.mfa_enabled !== true)) return null;
    if (requirements.ticket || requirements.readTicketId) {
      const ticket = await this.db.prepare(`SELECT group_id FROM tickets WHERE tenant_id=? AND id=? LIMIT 1`)
        .bind(this.scope.tenantId, requirements.ticket?.id ?? requirements.readTicketId).first<{ group_id: string | null }>();
      if (!ticket || (requirements.ticket && ticket.group_id !== requirements.ticket.groupId)) return null;
      if (credential.role === 'agent' && ticket.group_id !== null) {
        const member = await this.db.prepare(`SELECT 1 AS present FROM user_groups WHERE tenant_id=? AND user_id=? AND group_id=? LIMIT 1`)
          .bind(this.scope.tenantId, this.scope.actorId, ticket.group_id).first();
        if (!member) return null;
      }
    }
    if (requirements.capability && !await this.currentCapability(credential, requirements.capability)) return null;
    return { kind: 'session', sessionVersion: credential.sessionVersion };
  }

  /**
   * Matches the existing owner/role/tenant/deny-only-group fingerprint contract,
   * with a 65-membership sentinel instead of an unbounded group policy read.
   * The user_groups primary key supplies (tenant,user,group) order and each
   * constraint lookup uses its complete primary key. Unknown capabilities deny.
   */
  private async currentCapability(credential: SessionBudgetCredential, fence: CapabilityWriteFence): Promise<boolean> {
    if (fence.tenantId !== credential.tenantId || fence.actorId !== credential.actorId || fence.role !== credential.role
      || fence.sessionVersion !== credential.sessionVersion || !resolveCapability(fence.capability)) return false;
    const [policyResult, groupResult] = await this.db.batch([
      this.db.prepare(`SELECT owner.enabled AS owner_enabled,owner.revision AS owner_revision,
        role.enabled AS role_enabled,role.revision AS role_revision,tenant.enabled AS tenant_enabled,tenant.revision AS tenant_revision
        FROM deployment_capability_ceiling owner
        LEFT JOIN deployment_role_capability_grants role ON role.capability=owner.capability AND role.role=?
        LEFT JOIN tenant_role_capability_policies tenant ON tenant.capability=owner.capability AND tenant.role=? AND tenant.tenant_id=?
        WHERE owner.capability=? LIMIT 1`).bind(credential.role, credential.role, credential.tenantId, fence.capability),
      this.db.prepare(SESSION_BUDGET_GROUP_CAPABILITY_SQL).bind(credential.tenantId, credential.actorId, credential.tenantId, fence.capability),
    ]);
    const policy = policyResult.results[0] as { owner_enabled: number; owner_revision: number; role_enabled: number; role_revision: number; tenant_enabled: number; tenant_revision: number } | undefined;
    const groups = groupResult.results as { group_id: string; enabled: number | null; revision: number | null }[];
    if (!policy || policy.owner_enabled !== 1 || policy.role_enabled !== 1
      || (credential.role === 'agent' && policy.tenant_enabled !== 1) || groups.length > MAX_SESSION_BUDGET_GROUPS
      || groups.some(group => group.enabled === 0)) return false;
    const constrainedGroups = groups.filter(group => group.enabled !== null);
    return fence.policyFingerprint === JSON.stringify([policy.owner_revision, policy.role_revision,
      credential.role === 'agent' ? policy.tenant_revision : null,
      constrainedGroups.map(group => [group.group_id, group.revision]), credential.sessionVersion]);
  }
}
