import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { BudgetAuthorityPrincipal } from './budget-authority.repository';
import { budgetCommitConstraint } from './budget-commit-fence';
import type { VerifiedTenantScope } from '../types/tenant';

/** The admission identity is server-composed and used only in the D1 batch that changes auth state. */
export type CustomerAuthBudgetFence = Readonly<{ principal: BudgetAuthorityPrincipal; authority: BudgetCommitAuthority }>;
export class CustomerAuthBudgetFenceError extends Error {}

/**
 * Each auth-state write starts with this assertion.  It rechecks the live
 * widget key or customer session, the exact policy snapshot, and the paid
 * grant link in one D1 transaction before a token/session row can change.
 */
export function customerAuthFenceStatements(db: D1Database, scope: VerifiedTenantScope,
  fence: CustomerAuthBudgetFence): readonly D1PreparedStatement[] {
  const budget = budgetCommitConstraint(fence.authority, scope.tenantId, ['new-work', 'recovery']);
  const principal = fence.principal;
  const widget = principal.kind === 'widget'
    && scope.actorId === 'widget-anonymous' && scope.roles.includes('customer')
    && principal.widgetKey.length > 0 && principal.widgetKey.length <= 256;
  const session = principal.kind === 'session'
    && scope.roles.includes('customer') && Number.isSafeInteger(principal.sessionVersion)
    && principal.sessionVersion === scope.authVersion;
  const credentialSql = widget
    ? `EXISTS (SELECT 1 FROM tenant_config WHERE tenant_id=? AND key='widget.public_key' AND value=?)`
    : session
      ? `EXISTS (SELECT 1 FROM users WHERE tenant_id=? AND id=? AND role='customer' AND session_version=?)`
      : '0';
  const credentialValues = widget ? [scope.tenantId, principal.widgetKey]
    : session ? [scope.tenantId, scope.actorId, principal.sessionVersion] : [];
  const trusted = (widget || session) && fence.authority.snapshot.tenant_id === scope.tenantId;
  const assertion = db.prepare(`INSERT INTO customer_auth_budget_assertions(tenant_id,accepted)
    VALUES (?,CASE WHEN ?=1 AND ${credentialSql} AND ${budget.sql} THEN 1 ELSE 0 END)
    ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`)
    .bind(scope.tenantId, trusted ? 1 : 0, ...credentialValues, ...budget.values);
  const grant = fence.authority.grant;
  const linked = !!grant && grant.tenantId === scope.tenantId && grant.operationId === fence.authority.operationId
    && grant.operationFingerprint === fence.authority.operationFingerprint;
  const operation = db.prepare(`INSERT INTO budget_grant_operations
    (tenant_id,reservation_id,holder_id,operation_id,aggregate_id,operation_fingerprint,operation_envelope_json)
    SELECT ?,?,?,?,?,?,? WHERE ?=1 AND EXISTS (SELECT 1 FROM customer_auth_budget_assertions WHERE tenant_id=? AND accepted=1)
      AND NOT EXISTS (SELECT 1 FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?)
    ON CONFLICT(tenant_id,reservation_id,holder_id,operation_id) DO UPDATE SET operation_id=excluded.operation_id
      WHERE aggregate_id=excluded.aggregate_id AND operation_fingerprint=excluded.operation_fingerprint
        AND operation_envelope_json=excluded.operation_envelope_json`)
    .bind(scope.tenantId, grant?.reservationId ?? '', grant?.holderId ?? '', grant?.operationId ?? '', grant?.aggregateId ?? '',
      grant?.operationFingerprint ?? '', JSON.stringify(grant?.operationEnvelope ?? {}), linked ? 1 : 0, scope.tenantId,
      scope.tenantId, grant?.reservationId ?? '', grant?.holderId ?? '');
  const exact = db.prepare(`UPDATE customer_auth_budget_assertions SET accepted=CASE WHEN accepted=1
    AND NOT EXISTS (SELECT 1 FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?)
    AND EXISTS (SELECT 1 FROM budget_grant_operations WHERE tenant_id=? AND reservation_id=? AND holder_id=? AND operation_id=?
      AND aggregate_id=? AND operation_fingerprint=? AND operation_envelope_json=?) THEN 1 ELSE 0 END WHERE tenant_id=?`)
    .bind(scope.tenantId, grant?.reservationId ?? '', grant?.holderId ?? '', scope.tenantId, grant?.reservationId ?? '', grant?.holderId ?? '',
      grant?.operationId ?? '', grant?.aggregateId ?? '', grant?.operationFingerprint ?? '', JSON.stringify(grant?.operationEnvelope ?? {}), scope.tenantId);
  return [assertion, operation, exact];
}

export function customerAuthAcceptedSql(): string {
  return `EXISTS (SELECT 1 FROM customer_auth_budget_assertions WHERE tenant_id=? AND accepted=1)`;
}
