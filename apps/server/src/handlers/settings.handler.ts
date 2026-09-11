import { Hono } from "hono";
import { Env } from "../bindings";
import { authMiddleware } from "../middleware/auth.middleware";
import { mfaGuard } from "../middleware/mfa.guard";
import { roleGuard } from "../middleware/role.guard";
import { permissionGuard, permissionWriteFence, revalidatePermission } from "../middleware/permission.guard";
import { AppVariables } from "../types";
import { z } from "zod";
import filters from "./filters.handler";
import { CloudflareService } from "../services/cloudflare.service";
import { encryptString } from "../utils/crypto";
import { tenantMiddleware, TenantRequestDeps } from "../middleware/tenant.middleware";
import { parseTocynTenantTheme, TOCYN_THEME_CONTRACT_VERSION, type TocynTenantTheme } from "@luminatick/shared/ui-theme";
import { requestBounds } from '../middleware/request-bounds';
import { MutationInputError, readMutationJson } from './mutation-request';
import { readIdempotencyKey } from './mutation-request';
import { AdminSettingsMutationError, AdminSettingsMutationService } from '../services/admin-settings-mutation.service';
import { apiTicketBudgetCache, sessionTicketBudgetAdmission, staffTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import { SessionBudgetCredential } from '../repositories/session-budget-authority.repository';

const settings = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Apply auth, tenant composition, and MFA globally
settings.use("*", authMiddleware, tenantMiddleware, mfaGuard);

// Mount filters router
settings.route("/filters", filters);

const ALLOWED_SETTINGS_KEYS = new Set([
  "APP_NAME",
  "PUBLIC_URL",
  "PORTAL_URL",
  "TICKET_PREFIX",
  "RESEND_FROM_EMAIL",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "OPENAI_SECRET",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "SLACK_WEBHOOK_URL",
  "RESEND_API_KEY",
  "SUPPORT_EMAIL",
  "COMPANY_NAME",
  "SYSTEM_PROMPT",
  "NOTIFICATION_EMAIL",
  "agent_settings_permissions"
]);

const SENSITIVE_SETTINGS_KEYS = new Set([
  "TURNSTILE_SECRET_KEY",
  "RESEND_API_KEY",
  "SLACK_WEBHOOK_URL",
  "OPENAI_SECRET"
]);

const updateSettingsSchema = z.record(
  z.string()
    .min(1, "Key cannot be empty")
    .max(100, "Key is too long")
    .regex(/^[A-Z0-9_]+$/, "Key must be uppercase alphanumeric and underscores only"),
  z.string()
    .max(5000, "Value is too long")
);

const settingsPayloadSchema = z.record(z.unknown()).refine(data => Object.keys(data).length <= 50, {
  message: "Too many settings provided",
});
const THEME_CONFIG_KEY = 'ui.theme.v1';

function parseTenantTheme(value: string | null): TocynTenantTheme & { fallback: boolean } {
  const fallback = { version: TOCYN_THEME_CONTRACT_VERSION, light: {}, dark: {} } as const;
  if (!value) return { ...fallback, fallback: false };
  try {
    if (new TextEncoder().encode(value).length > 8192) throw new TypeError('Stored theme exceeds limit');
    return { ...parseTocynTenantTheme(JSON.parse(value)), fallback: false };
  } catch {
    // Never expose corrupt or unsafe stored values; package defaults remain the safe result.
    return { ...fallback, fallback: true };
  }
}

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_SETTINGS_KEYS.has(key)) return true;
  if (key === 'TURNSTILE_SITE_KEY') return false;
  return key.endsWith('_TOKEN') || key.endsWith('_KEY') || key.endsWith('_SECRET') || key.includes('PASSWORD') || key.includes('_ACCESS_KEY_');
}

/** Optional legacy mode remains explicit; any configured malformed/enabled boundary fails closed. */
function adminAdmission(c: any, capability: any): AdminSettingsMutationService | Response | null {
  if (c.env.BUDGET_ADMISSION_POLICY === undefined) return null;
  const mode = staffTicketAdmissionMode(c.env);
  if (mode === 'disabled') return null;
  const deps = c.get('tenantDeps') as TenantRequestDeps | undefined, payload = c.get('jwtPayload');
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

async function admitRead(c: any, operation: 'dashboard.settings.read' | 'dashboard.settings.theme.read', capability: any): Promise<Response | Record<string,string> | null> {
  const admission = adminAdmission(c, capability); if (admission instanceof Response) return admission; if (!admission) return null;
  try { return await admission.read(operation, capability, (repo,commit)=>repo.readSettings(commit,operation==='dashboard.settings.theme.read'?[THEME_CONFIG_KEY]:[...ALLOWED_SETTINGS_KEYS])); }
  catch (error) { if (error instanceof AdminSettingsMutationError) return c.json({ code: error.code, error: error.message }, error.status); throw error; }
}

/**
 * GET /api/settings/usage
 * Fetch usage stats from Cloudflare GraphQL Analytics API
 */
settings.get("/usage", roleGuard(["admin"]), permissionGuard("usage"), async (c) => {
  // Provider analytics is optional #90 work, not authoritative admission data.
  // Combined/invalid policies must not read provider credentials or call an
  // unadmitted external analytics endpoint. Explicit legacy modes stay compatible.
  if (c.env.BUDGET_ADMISSION_POLICY !== undefined && staffTicketAdmissionMode(c.env) !== 'disabled') {
    c.header('Cache-Control', 'private, no-store');
    return c.json({ code: 'provider_usage_not_admitted',
      error: 'Provider usage analytics is unavailable under the active budget policy.' }, 503);
  }
  try {
    const cfService = new CloudflareService(c.env, c.get('tenantDeps') as TenantRequestDeps);
    const stats = await cfService.getUsageStats();
    return c.json(stats);
  } catch (err: any) {
    if (err.message === 'Cloudflare credentials not configured') {
      return c.json({ error: err.message }, 400);
    }
    return c.json({ error: err.message }, 500);
  }
});

/** Branding is readable by authenticated operators; editing requires settings capability. */
settings.get('/theme', roleGuard(["admin", "agent"]), async c => {
  c.header('Cache-Control', 'private, no-store');
  const admitted = await admitRead(c, 'dashboard.settings.theme.read', undefined); if (admitted instanceof Response) return admitted;
  const d = c.get('tenantDeps') as TenantRequestDeps;
  return c.json(parseTenantTheme(admitted ? admitted[THEME_CONFIG_KEY] ?? null : await d.repositories.config.get(THEME_CONFIG_KEY)));
});

settings.put('/theme', roleGuard(["admin", "agent"]), permissionGuard("general"), requestBounds(8192), async c => {
  let body: unknown;
  try { body = await readMutationJson(c); }
  catch (error) {
    if (error instanceof MutationInputError) return c.json({ error: error.message }, error.status);
    throw error;
  }
  let parsed: TocynTenantTheme;
  try {
    parsed = parseTocynTenantTheme(body);
  } catch {
    return c.json({ error: 'Invalid tenant theme' }, 400);
  }
  const revalidationFailure = await revalidatePermission(c, "general");
  if (revalidationFailure) return revalidationFailure;
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const capability = permissionWriteFence(c, "general"), admission = adminAdmission(c, capability);
  if (admission instanceof Response) return admission;
  if (!admission) { await d.repositories.config.set(THEME_CONFIG_KEY, JSON.stringify(parsed), capability); return c.json({ success: true, version: TOCYN_THEME_CONTRACT_VERSION }); }
  try {
    const prepared = await admission.prepareMutation('dashboard.settings.theme.update', capability, parsed, readIdempotencyKey(c));
    const outcome = await admission.commit(prepared, (repo, commit) => repo.commitSettings(commit, { [THEME_CONFIG_KEY]: JSON.stringify(parsed) }, JSON.stringify({ success: true, version: TOCYN_THEME_CONTRACT_VERSION })));
    if (outcome.replayed && outcome.keyed) c.header('Idempotency-Replayed', 'true');
    return c.json(outcome.body);
  } catch (error) { if (error instanceof MutationInputError) return c.json({ code: error.code, error: error.message }, error.status); if (error instanceof AdminSettingsMutationError) return c.json({ code: error.code, error: error.message }, error.status); throw error; }
});

/**
 * GET /api/settings
 * Fetch all tenant settings as a key-value object
 */
settings.get("/", roleGuard(["admin", "agent"]), permissionGuard("general"), async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const revalidationFailure = await revalidatePermission(c, 'general'); if (revalidationFailure) return revalidationFailure;
  const admitted = await admitRead(c, 'dashboard.settings.read', permissionWriteFence(c, 'general')); if (admitted instanceof Response) return admitted;
  const settingsObj: Record<string, string> = {};

  const hasKey = !!c.env.APP_MASTER_KEY;

  for (const key of ALLOWED_SETTINGS_KEYS) {
    const val = admitted ? admitted[key] ?? null : await d.repositories.config.get(key);
    if (val !== null) {
      if (isSensitiveKey(key) && val) {
        if (!hasKey) {
          return c.json({ error: "APP_MASTER_KEY is missing. Cannot verify settings." }, 500);
        }
        settingsObj[key] = "••••••••";
      } else {
        settingsObj[key] = val;
      }
    }
  }

  return c.json(settingsObj);
});

/**
 * PUT /api/settings
 * Update multiple tenant settings
 */
settings.put("/", roleGuard(["admin", "agent"]), permissionGuard("general"), requestBounds(64 * 1024), async (c) => {
  let body: unknown;
  try { body = await readMutationJson(c); } catch (error) { if (error instanceof MutationInputError) return c.json({ error: error.message }, error.status); throw error; }
  const payloadResult = settingsPayloadSchema.safeParse(body);
  if (!payloadResult.success) {
    return c.json({ error: payloadResult.error.errors[0].message }, 400);
  }

  const result = updateSettingsSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const updates = result.data;
  const d = c.get('tenantDeps') as TenantRequestDeps;

  // Validate every key before any writes, including mixed valid/invalid payloads.
  for (const key of Object.keys(updates)) {
    if (!ALLOWED_SETTINGS_KEYS.has(key)) return c.json({ error: `Setting key '${key}' is not permitted` }, 400);
  }

  const revalidationFailure = await revalidatePermission(c, "general");
  if (revalidationFailure) return revalidationFailure;

  const persisted: Record<string, string> = {};
  for (let [key, value] of Object.entries(updates)) {
    if (key === 'agent_settings_permissions') {
      return c.json({ error: "Cannot modify agent permissions via this endpoint" }, 403);
    }

    if (!ALLOWED_SETTINGS_KEYS.has(key)) {
      return c.json({ error: `Setting key '${key}' is not permitted` }, 400);
    }

    if (isSensitiveKey(key) && value === "••••••••") {
      continue;
    }

    if (isSensitiveKey(key) && value) {
      if (!c.env.APP_MASTER_KEY) {
        return c.json({ error: "APP_MASTER_KEY is missing. Cannot encrypt sensitive settings." }, 500);
      }
      value = await encryptString(value, c.env.APP_MASTER_KEY);
    }

    persisted[key] = value;
  }
  const capability = permissionWriteFence(c, 'general'), admission = adminAdmission(c, capability);
  if (admission instanceof Response) return admission;
  if (!admission) { for (const [key, value] of Object.entries(persisted)) await d.repositories.config.set(key, value, capability); return c.json({ success: true }); }
  try {
    const prepared = await admission.prepareMutation('dashboard.settings.update', capability, updates, readIdempotencyKey(c));
    const outcome = await admission.commit(prepared, (repo, commit) => repo.commitSettings(commit, persisted, JSON.stringify({ success: true })));
    if (outcome.replayed && outcome.keyed) c.header('Idempotency-Replayed', 'true');
    return c.json(outcome.body);
  } catch (error) { if (error instanceof MutationInputError) return c.json({ code: error.code, error: error.message }, error.status); if (error instanceof AdminSettingsMutationError) return c.json({ code: error.code, error: error.message }, error.status); throw error; }
});

export default settings;
