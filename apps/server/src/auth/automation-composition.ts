import { Env } from '../bindings';
import { AutomationTenantResolver, SnoozeTenantResolver } from './automation-resolver';
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

/**
 * Production cron boundary for due snoozes. Discovery is bounded before a
 * tenant scope exists, and each selected tenant gets an independent trusted
 * system scope. A failed tenant is deliberately left at the cursor so the
 * next cron can retry its idempotent conditional transition.
 */
export async function runScheduledSnoozeResurface(env: Env, now: () => number = Date.now) {
  const resolver = new SnoozeTenantResolver(env.DB);
  const tenantIds = await resolver.getActiveTenantIds(await resolver.cursor());
  if (!tenantIds.length) { await resolver.setCursor(null); return { resurfaced: 0, failedTenants: 0 }; }
  let resurfaced = 0, failedTenants = 0;
  for (const tenantId of tenantIds) {
    try {
      const scope = createSystemTenantScope({ tenantId, actor: 'scheduled-snooze-resurface' });
      const ids = await createTenantRequestDeps(scope, env).repositories.supportStates.resurfaceDue(new Date(now()).toISOString());
      resurfaced += ids.length;
      await resolver.setCursor(tenantId);
    } catch (error) {
      failedTenants++;
      console.error(`Due snooze resurface failed for tenant ${tenantId}; it will retry`, error);
      break;
    }
  }
  return { resurfaced, failedTenants };
}
