import { Context, Next } from 'hono';
import { VerifiedTenantScope } from '../types/tenant';
import { Repositories } from '../repositories/interfaces';
import { createRepositories } from '../repositories';
import { TenantAttachmentStorage, LegacyArticleBodyStorage, TenantVectorStorage } from '../storage/adapters';

export type TenantRequestDeps = {
  scope: VerifiedTenantScope;
  repositories: Repositories;
  attachmentStorage: TenantAttachmentStorage;
  legacyArticleStorage?: LegacyArticleBodyStorage;
  vectorStorage: TenantVectorStorage;
};

export const tenantMiddleware = async (c: Context, next: Next) => {
  const scope = c.get('tenantScope') as VerifiedTenantScope | undefined;

  if (!scope) {
    return c.json({ error: "Unauthorized: Missing verified tenant scope" }, 401);
  }

  // Trusted composition boundary
  const deps = createTenantRequestDeps(scope, c.env);

  c.set('tenantDeps', deps);
  await next();
};


export function createTenantRequestDeps(scope: VerifiedTenantScope, env: any): TenantRequestDeps {
  const repositories = createRepositories(scope, env.DB);
  const attachmentStorage = new TenantAttachmentStorage(scope, env.ATTACHMENTS_BUCKET);
  const legacyArticleStorage = scope.tenantId === 'default-tenant' ? new LegacyArticleBodyStorage(scope, env.ATTACHMENTS_BUCKET) : undefined;
  const vectorStorage = new TenantVectorStorage(scope, env.VECTOR_INDEX);

  return {
    scope,
    repositories,
    attachmentStorage,
    legacyArticleStorage,
    vectorStorage
  };
}

import { InboundTenantResolver } from '../auth/inbound-resolver';
export function createInboundResolver(env: any): InboundTenantResolver {
  return new InboundTenantResolver(env.DB);
}
