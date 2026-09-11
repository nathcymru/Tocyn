import { authorizeLocalBeta } from '../middleware/local-beta';
import { Env } from '../bindings';
import { TenantRequestDeps, createTenantRequestDeps } from '../middleware/tenant.middleware';
import { ApiAuthResolver, ApiKeyResolution } from './api-key-resolver';
import { createVerifiedTenantScope } from './scope';
import type { RequestCanonicalMutationSli } from '../observability/request-canonical-mutation-sli';
import type { ResourceOperationEmitter } from '../observability/resource-operation';

/**
 * Trusted API-auth composition boundary.
 * Converts a narrow ApiKeyResolution into a full TenantRequestDeps.
 * The API key receives an integration scope, NOT a system scope.
 */
export async function resolveApiKeyRequestDeps(
  resolver: ApiAuthResolver,
  apiKeyRaw: string,
  env: Env,
  canonicalMutationSli?: RequestCanonicalMutationSli,
  sharedEmitter?: ResourceOperationEmitter,
): Promise<{ deps: TenantRequestDeps; resolution: ApiKeyResolution } | null> {
  const resolution = await resolver.resolveKey(apiKeyRaw);

  if (!resolution) {
    return null;
  }

  return composeApiKeyRequestDeps(resolution, env, canonicalMutationSli, sharedEmitter);
}

/** Builds trusted dependencies only after API-key credential resolution. */
export async function composeApiKeyRequestDeps(
  resolution: ApiKeyResolution,
  env: Env,
  canonicalMutationSli?: RequestCanonicalMutationSli,
  sharedEmitter?: ResourceOperationEmitter,
): Promise<{ deps: TenantRequestDeps; resolution: ApiKeyResolution }> {

  // Integration principal — NOT createSystemTenantScope
  const scope = createVerifiedTenantScope(
    resolution.tenantId,
    resolution.apiKeyId,
    ['integration'],
    1
  );

  await authorizeLocalBeta(env, scope, { kind: 'api-key', id: resolution.apiKeyId }, sharedEmitter);
  const deps = createTenantRequestDeps(scope, env, undefined, canonicalMutationSli, sharedEmitter);
  // Usage metadata is not authentication authority. Record it only after scoped composition.
  try { await deps.repositories.apiKeys.recordUsage(resolution.apiKeyId); }
  catch { /* Best-effort telemetry must not reject an already validated key. */ }

  return { deps, resolution };
}
