import type { Context, Next } from 'hono';
import type { BudgetPurpose } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { AppVariables } from '../types';
import { ownerIngressAdmissionCache } from '../budgets/owner-ingress-admission.service';
import { createOwnerIngressBudgetAuthority } from './tenant.middleware';
import type { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import type { BudgetCoordinatorDO } from '../durable_objects/BudgetCoordinatorDO';
import * as jose from 'jose';

const OWNER_INGRESS_POLICY = 'owner-ingress-v1';
const UNVERIFIED_INGRESS_LIMIT = 5;
const UNVERIFIED_INGRESS_WINDOW_MS = 60_000;
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
  // Health probes are operational liveness checks, not application work. They
  // must stay available without reserving a shared owner envelope.
  if (c.req.method === 'GET' && c.req.path === '/health') { await next(); return; }
  const configured = c.env.OWNER_INGRESS_ADMISSION_POLICY;
  if (configured === undefined || configured === 'off') { await next(); return; }
  if (configured !== OWNER_INGRESS_POLICY || !c.env.BUDGET_COORDINATOR_DO) {
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  }
  let repository: BudgetAuthorityRepository;
  try { repository = createOwnerIngressBudgetAuthority(c.env, c.get('resourceOperationEmitter')); }
  catch { return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503); }
  const signed=await hasSignedBearerCredential(c);
  const result = signed ? await ownerIngressAdmissionCache.admit({
    repository, namespace: c.env.BUDGET_COORDINATOR_DO, purpose: ownerIngressPurpose(c.req.method, c.req.path), now: c.env.localNow,
  }) : await ownerIngressAdmissionCache.admitUnverified({
    repository, namespace: c.env.BUDGET_COORDINATOR_DO, purpose: ownerIngressPurpose(c.req.method, c.req.path), now: c.env.localNow,
    limit: UNVERIFIED_INGRESS_LIMIT, windowMs: UNVERIFIED_INGRESS_WINDOW_MS,
  });
  if (result.status !== 'admitted') {
    if (result.status === 'rejected' && result.reason === 'unverified-limit') return c.json({ error: 'Too many requests, please try again later.' }, 429);
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

async function hasSignedBearerCredential(c: Context<{ Bindings: Env; Variables: AppVariables }>): Promise<boolean> {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ') || !c.env.JWT_SECRET) return false;
  try {
    await jose.jwtVerify(header.substring(7), new TextEncoder().encode(c.env.JWT_SECRET), {
      algorithms: ['HS256'], requiredClaims: ['exp', 'iat', 'sub'], audience: ['app', 'widget', 'mfa-challenge'],
    });
    return true;
  } catch { return false; }
}
