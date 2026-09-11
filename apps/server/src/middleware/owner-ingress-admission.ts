import type { Context, Next } from 'hono';
import type { BudgetPurpose } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { AppVariables } from '../types';
import { ownerIngressAdmissionCache } from '../budgets/owner-ingress-admission.service';
import { createOwnerIngressBudgetAuthority } from './tenant.middleware';
import type { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';

const OWNER_INGRESS_POLICY = 'owner-ingress-v1';
const RECOVERY_ROUTES = new Set([
  'POST /api/auth/mfa/verify',
  'POST /api/auth/mfa/setup',
  'POST /api/auth/mfa/confirm',
  'POST /api/auth/mfa/disable',
  'POST /api/auth/logout',
  'POST /api/v1/customer/auth/verify',
  'POST /api/v1/customer/auth/logout',
]);

export function ownerIngressPurpose(method: string, path: string): BudgetPurpose {
  return RECOVERY_ROUTES.has(`${method.toUpperCase()} ${path}`) ? 'recovery' : 'new-work';
}

/**
 * The first server-controlled admission boundary for HTTP traffic. Its
 * explicit release switch derives the owner from current D1 authority and
 * never accepts a tenant or allocation from the request.
 */
export async function ownerIngressAdmission(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next,
): Promise<Response | void> {
  const configured = c.env.OWNER_INGRESS_ADMISSION_POLICY;
  if (configured === undefined || configured === 'off') { await next(); return; }
  if (configured !== OWNER_INGRESS_POLICY || !c.env.BUDGET_COORDINATOR_DO) {
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  }
  let repository: BudgetAuthorityRepository;
  try { repository = createOwnerIngressBudgetAuthority(c.env, c.get('resourceOperationEmitter')); }
  catch { return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503); }
  const result = await ownerIngressAdmissionCache.admit({
    repository,
    namespace: c.env.BUDGET_COORDINATOR_DO,
    purpose: ownerIngressPurpose(c.req.method, c.req.path),
    now: c.env.localNow,
  });
  if (result.status !== 'admitted') {
    const exhausted = result.status === 'rejected' && result.reason === 'exhausted';
    if (exhausted && result.retryAt !== undefined) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((result.retryAt - (c.env.localNow?.() ?? Date.now())) / 1_000))));
    }
    return c.json({ code: exhausted ? 'budget_exhausted' : 'budget_admission_unavailable',
      error: exhausted ? 'Configured budget capacity is exhausted' : 'Budget admission authority is unavailable' }, exhausted ? 429 : 503);
  }
  c.set('ownerIngressAdmission', result.admission);
  try {
    await next();
  } finally {
    // A failed closure is deliberately silent to the response and retains the
    // full owner charge. The request never receives a false refund.
    await result.admission.finish().catch(() => 'retained');
  }
}
