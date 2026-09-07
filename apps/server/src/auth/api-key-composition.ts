import { Env } from '../bindings';
import { TenantRequestDeps, createTenantRequestDeps } from '../middleware/tenant.middleware';
import { ApiAuthResolver, ApiKeyResolution } from './api-key-resolver';
import { createVerifiedTenantScope } from './scope';

/**
 * Trusted API-auth composition boundary.
 * Converts a narrow ApiKeyResolution into a full TenantRequestDeps.
 * The API key receives an integration scope, NOT a system scope.
 */
export async function resolveApiKeyRequestDeps(
  resolver: ApiAuthResolver,
  apiKeyRaw: string,
  env: Env
): Promise<{ deps: TenantRequestDeps; resolution: ApiKeyResolution } | null> {
  const resolution = await resolver.resolveKey(apiKeyRaw);

  if (!resolution) {
    return null;
  }

  // Integration principal — NOT createSystemTenantScope
  const scope = createVerifiedTenantScope(
    resolution.tenantId,
    resolution.apiKeyId,
    ['integration'],
    1
  );

  const deps = createTenantRequestDeps(scope, env);
  // Usage metadata is not authentication authority. Record it only after scoped composition.
  try { await deps.repositories.apiKeys.recordUsage(resolution.apiKeyId); }
  catch { /* Best-effort telemetry must not reject an already validated key. */ }

  return { deps, resolution };
}
