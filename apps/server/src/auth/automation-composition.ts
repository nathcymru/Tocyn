import { Env } from '../bindings';
import { AutomationTenantResolver } from './automation-resolver';
import { createSystemTenantScope } from './scope';
import { createTenantRequestDeps } from '../middleware/tenant.middleware';
import { TenantAutomationService } from '../services/tenant-automation.service';

/** Trusted scheduled-event boundary; no request payload supplies tenant identity. */
export async function runScheduledRetention(env: Env) {
  const resolver = new AutomationTenantResolver(env.DB);
  const tenantIds = await resolver.getActiveTenantIds(await resolver.cursor());
  const total = { deleted_tickets: 0, deleted_attachments: 0 };
  if (!tenantIds.length) { await resolver.setCursor(null); return total; }
  for (const tenantId of tenantIds) {
    const scope = createSystemTenantScope({ tenantId, actor: 'scheduled-retention' });
    const result = await new TenantAutomationService(createTenantRequestDeps(scope, env)).runBoundedRetention({ env });
    total.deleted_tickets += result.deleted_tickets;
    total.deleted_attachments += result.deleted_attachments;
    await resolver.setCursor(tenantId);
  }
  return total;
}
