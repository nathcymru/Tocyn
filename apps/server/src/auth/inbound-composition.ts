import { Env } from '../bindings';
import { TenantRequestDeps, createTenantRequestDeps } from '../middleware/tenant.middleware';
import { InboundTenantResolver } from './inbound-resolver';
import { createSystemTenantScope } from './scope';

export async function resolveInboundRequestDeps(
  resolver: InboundTenantResolver,
  emailAddress: string,
  env: Env
): Promise<TenantRequestDeps | null> {
  const resolution = await resolver.resolveRecipient(emailAddress);

  if (!resolution) {
    return null;
  }

  const scope = createSystemTenantScope({
    tenantId: resolution.tenantId,
    actor: 'inbound-email'
  });

  return createTenantRequestDeps(scope, env);
}
