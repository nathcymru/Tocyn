import type { Context } from 'hono';
import type { Env } from '../bindings';
import type { AppVariables, JWTPayload } from '../types';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { staffTicketAdmissionMode, sessionTicketBudgetAdmission, apiTicketBudgetCache } from '../middleware/budget-admission.middleware';
import { BalancedAssignmentRepository } from '../repositories/balanced-assignment.repository';
import { BalancedAssignmentService } from '../services/balanced-assignment.service';
import { BalancedAssignmentError } from '../types/balanced-assignment';
/** Dashboard mounts POST /tickets/:id/balanced-assignment with requestBounds(1024).
 * No new catalogue capability: same current staff/session/group assignment authority as responsible-owner. */
export async function balancedAssignmentHandler(c: Context<{
  Bindings: Env;
  Variables: AppVariables;
}>): Promise<Response> {
  const deps = c.get('tenantDeps') as TenantRequestDeps, payload = c.get('jwtPayload') as JWTPayload;
  const now = () => c.env.localNow?.() ?? Date.now();
  if (staffTicketAdmissionMode(c.env) !== 'enabled' || !c.env.BUDGET_COORDINATOR_DO)
    return c.json({ code: 'routing_admission_unavailable', error: 'Routing unavailable. Ticket remains unchanged.' }, 503);
  if (!payload || payload.tenant_id !== deps.scope.tenantId || payload.sub !== deps.scope.actorId || !['admin', 'agent'].includes(payload.role)
    || payload.mfa_verified !== true || !Number.isSafeInteger(payload.session_version) || !Number.isSafeInteger(payload.exp))
    return c.json({ code: 'routing_denied', error: 'Routing is not authorized.' }, 403);
  const key = c.req.header('Idempotency-Key');
  if (!key)
    return c.json({ code: 'idempotency_key_required', error: 'Idempotency-Key is required.' }, 400);
  // Selection and override are server-owned; no request fields are accepted.
  const body = await c.req.text();
  if (body.trim() && body.trim() !== '{}')
    return c.json({ code: 'invalid_routing_request', error: 'No routing fields are accepted.' }, 400);
  const repository = new BalancedAssignmentRepository(deps.database, deps.scope, deps.operatorActivity, deps.betaAdmission);
  const service = new BalancedAssignmentService(deps.database, deps.scope, {
    tenantId: deps.scope.tenantId, actorId: payload.sub, role: payload.role as 'admin' | 'agent',
    sessionVersion: payload.session_version!, expiresAt: payload.exp, mfaVerified: true
  }, repository, {
    service: sessionTicketBudgetAdmission,
    repository: deps.repositories.budgetAuthority, namespace: c.env.BUDGET_COORDINATOR_DO, now, settle: (authority, state, time) => apiTicketBudgetCache.settleOperation(authority, state, time)
  });
  try {
    const result = await service.execute(c.req.param('id') ?? '', key);
    c.header('Cache-Control', 'private, no-store');
    c.header('Idempotency-Replayed', String(result.replayed));
    const response = c.json({
      outcome: result.outcome, ownerId: result.ownerId, replayed: result.replayed, message: result.replayed
        ? 'Previous routing result restored. Refresh the ticket for current ownership.'
        : result.outcome === 'assigned' ? 'Assigned to an available operator.' : 'No operator had capacity at this attempt. The ticket was left unassigned.'
    });
    service.finish(result);
    return response;
  }
  catch (error) {
    service.finish();
    if (error instanceof BalancedAssignmentError)
      return c.json({ code: error.code, error: error.status === 403 ? 'Routing is not authorized.' : 'Routing unavailable. Refresh and retry; no assignment was confirmed.' }, error.status);
    return c.json({ code: 'routing_unavailable', error: 'Routing unavailable. Refresh and retry; no assignment was confirmed.' }, 503);
  }
}
