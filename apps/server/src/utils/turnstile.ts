import { Env } from "../bindings";
import { decryptString } from "./crypto";
import { TenantRequestDeps } from "../middleware/tenant.middleware";

/**
 * Verifies a Cloudflare Turnstile token if TURNSTILE_SECRET_KEY is configured for the given tenant.
 *
 * @param deps The tenant dependencies
 * @param token The turnstile token provided by the client
 * @param ip The client's IP address (optional)
 * @returns true if valid or if Turnstile is disabled for this tenant, false if invalid
 */
export async function verifyTurnstileToken(env: Env, deps: TenantRequestDeps, token?: string, ip?: string): Promise<boolean> {
  if (!deps || !deps.scope.tenantId) {
    return false; // Fail closed if tenant context is missing
  }

  const secretKey = await deps.repositories.config.get('TURNSTILE_SECRET_KEY');

  if (!secretKey) {
    // Turnstile is disabled for this tenant
    return true;
  }

  if (!env.APP_MASTER_KEY) {
    throw new Error("Server misconfiguration: APP_MASTER_KEY is missing.");
  }

  if (!token) {
    // Token is required when Turnstile is enabled
    return false;
  }

  const decryptedKey = await decryptString(secretKey, env.APP_MASTER_KEY);

  const formData = new FormData();
  formData.append('secret', decryptedKey);
  formData.append('response', token);
  if (ip) {
    formData.append('remoteip', ip);
  }

  const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: formData,
  });

  const turnstileData = await turnstileRes.json() as { success: boolean };
  return turnstileData.success === true;
}
