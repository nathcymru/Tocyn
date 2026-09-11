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

/**
 * GET /api/settings/usage
 * Fetch usage stats from Cloudflare GraphQL Analytics API
 */
settings.get("/usage", roleGuard(["admin"]), permissionGuard("usage"), async (c) => {
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
  const d = c.get('tenantDeps') as TenantRequestDeps;
  return c.json(parseTenantTheme(await d.repositories.config.get(THEME_CONFIG_KEY)));
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
  await d.repositories.config.set(THEME_CONFIG_KEY, JSON.stringify(parsed), permissionWriteFence(c, "general"));
  return c.json({ success: true, version: TOCYN_THEME_CONTRACT_VERSION });
});

/**
 * GET /api/settings
 * Fetch all tenant settings as a key-value object
 */
settings.get("/", roleGuard(["admin", "agent"]), permissionGuard("general"), async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const settingsObj: Record<string, string> = {};

  const hasKey = !!c.env.APP_MASTER_KEY;

  for (const key of ALLOWED_SETTINGS_KEYS) {
    const val = await d.repositories.config.get(key);
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
settings.put("/", roleGuard(["admin", "agent"]), permissionGuard("general"), async (c) => {
  const body = await c.req.json();
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

    await d.repositories.config.set(key, value, permissionWriteFence(c, "general"));
  }

  return c.json({ success: true });
});

export default settings;
