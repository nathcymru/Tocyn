import { Context, Next } from 'hono';
import { VerifiedTenantScope } from '../types/tenant';
import { Repositories } from '../repositories/interfaces';
import { createRepositories } from '../repositories';
import { TenantAttachmentStorage, LegacyArticleBodyStorage } from '../storage/adapters';

export type TenantRequestDeps = {
  scope: VerifiedTenantScope;
  repositories: Repositories;
  attachmentStorage: TenantAttachmentStorage;
  legacyArticleStorage?: LegacyArticleBodyStorage;
};

export const tenantMiddleware = async (c: Context, next: Next) => {
  const scope = c.get('tenantScope') as VerifiedTenantScope | undefined;
  
  if (!scope) {
    return c.json({ error: "Unauthorized: Missing verified tenant scope" }, 401);
  }

  // Trusted composition boundary
  const repositories = createRepositories(scope, c.env.DB);
  const attachmentStorage = new TenantAttachmentStorage(scope, c.env.ATTACHMENTS_BUCKET);
  const legacyArticleStorage = scope.tenantId === 'default-tenant' ? new LegacyArticleBodyStorage(scope, c.env.ATTACHMENTS_BUCKET) : undefined;

  const deps: TenantRequestDeps = {
    scope,
    repositories,
    attachmentStorage,
    legacyArticleStorage
  };

  c.set('tenantDeps', deps);
  await next();
};
