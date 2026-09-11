import { Hono } from "hono";
import { z } from "zod";
import { CAPABILITY_CATALOG } from "../auth/capability-policy";
import { Env } from "../bindings";
import { authMiddleware } from "../middleware/auth.middleware";
import { mfaGuard } from "../middleware/mfa.guard";
import { permissionGuard, permissionWriteFence, revalidatePermission } from "../middleware/permission.guard";
import { roleGuard } from "../middleware/role.guard";
import { tenantMiddleware } from "../middleware/tenant.middleware";
import { AppVariables } from "../types";
import { requestBounds } from '../middleware/request-bounds';
import { MutationInputError, readIdempotencyKey, readMutationJson } from './mutation-request';
import { AdminSettingsMutationError, AdminSettingsMutationService } from '../services/admin-settings-mutation.service';
import { apiTicketBudgetCache, sessionTicketBudgetAdmission, staffTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import { SessionBudgetCredential } from '../repositories/session-budget-authority.repository';

const permissions = new Hono<{ Bindings: Env; Variables: AppVariables }>();
permissions.use("*", authMiddleware, tenantMiddleware, mfaGuard);

const updatePermissionsSchema = z.object({
  revision: z.number().int().min(1),
  policies: z.record(z.boolean()).refine(value => Object.keys(value).length <= CAPABILITY_CATALOG.length, 'Too many policies'),
}).strict();

function adminAdmission(c: any, capability: any): AdminSettingsMutationService | Response | null {
  if (c.env.BUDGET_ADMISSION_POLICY === undefined) return null;
  const mode = staffTicketAdmissionMode(c.env);
  if (mode === 'disabled') return null;
  const deps = c.get('tenantDeps'), payload = c.get('jwtPayload');
  if (mode !== 'enabled' || !c.env.BUDGET_COORDINATOR_DO || !deps || !payload || payload.sub !== deps.scope.actorId || payload.tenant_id !== deps.scope.tenantId
    || (payload.role !== 'admin' && payload.role !== 'agent') || payload.mfa_verified !== true || !Number.isSafeInteger(payload.session_version) || !Number.isSafeInteger(payload.exp)) {
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  }
  const credential: SessionBudgetCredential = { tenantId: deps.scope.tenantId, actorId: payload.sub, role: payload.role,
    sessionVersion: payload.session_version, expiresAt: payload.exp, mfaVerified: true };
  return new AdminSettingsMutationService(deps.database, deps.scope, credential, { service: sessionTicketBudgetAdmission,
    repository: deps.repositories.budgetAuthority, namespace: c.env.BUDGET_COORDINATOR_DO, now: () => c.env.localNow?.() ?? Date.now(),
    settle: (authority, outcome, now) => apiTicketBudgetCache.settleOperation(authority, outcome, now) });
}

permissions.get("/", roleGuard(["admin"]), permissionGuard("permissions.manage"), async (c) => {
  const revalidationFailure = await revalidatePermission(c, 'permissions.manage'); if (revalidationFailure) return revalidationFailure;
  const capability = permissionWriteFence(c, 'permissions.manage'), admission = adminAdmission(c, capability);
  if (admission instanceof Response) return admission;
  if (admission) {
    try { await admission.read('dashboard.permissions.read', capability); }
    catch (error) { if (error instanceof AdminSettingsMutationError) return c.json({ code: error.code, error: error.message }, error.status); throw error; }
  }
  return c.json(await c.get('tenantDeps')!.capabilityPolicy.getAgentPolicy());
});

permissions.put("/", roleGuard(["admin"]), permissionGuard("permissions.manage"), requestBounds(64 * 1024), async (c) => {
  let body: unknown;
  try { body = await readMutationJson(c); } catch (error) { if (error instanceof MutationInputError) return c.json({ error: 'Invalid permissions format' }, 400); throw error; }
  const result = updatePermissionsSchema.safeParse(body);
  if (!result.success) return c.json({ error: "Invalid permissions format" }, 400);

  const requested = new Map(
    CAPABILITY_CATALOG.filter(capability => capability.legacyKey)
      .map(capability => [capability.legacyKey!, capability.id]),
  );
  const policyEntries = Object.entries(result.data.policies);
  if (policyEntries.some(([key]) => !requested.has(key))) {
    return c.json({ error: "Unknown or deployment-owned capability" }, 400);
  }

  const revalidationFailure = await revalidatePermission(c, "permissions.manage");
  if (revalidationFailure) return revalidationFailure;

  const capability = permissionWriteFence(c, 'permissions.manage'), admission = adminAdmission(c, capability);
  if (admission instanceof Response) return admission;
  if (!admission) {
    const updated = await c.get('tenantDeps')!.capabilityPolicy.updateAgentPolicy(result.data.revision, result.data.policies, capability);
    if (!updated) return c.json({ error: 'Permission policy changed; reload and try again' }, 409);
    return c.json({ success: true, revision: result.data.revision + 1, sessionsRevoked: true });
  }
  try {
    const prepared = await admission.prepare('dashboard.permissions.update', capability, result.data, readIdempotencyKey(c));
    const response = { success: true, revision: result.data.revision + 1, sessionsRevoked: true };
    const outcome = await admission.commit(prepared, async (repo, commit) => {
      const written = await repo.commitAgentPolicy(commit, result.data.revision, result.data.policies, JSON.stringify(response));
      if (!written.updated || !written.snapshot) throw new AdminSettingsMutationError(409, 'permission_policy_changed', 'Permission policy changed; reload and try again');
      return written.snapshot;
    });
    if (outcome.replayed && outcome.keyed) c.header('Idempotency-Replayed', 'true');
    return c.json(outcome.body);
  } catch (error) { if (error instanceof MutationInputError) return c.json({ code: error.code, error: error.message }, error.status); if (error instanceof AdminSettingsMutationError) return c.json({ code: error.code, error: error.message }, error.status); throw error; }
});

export default permissions;
