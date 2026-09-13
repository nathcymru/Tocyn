import { Env } from '../bindings';
import { admitSnoozeDue } from '../budgets/snooze-due-admission.service';
import { SnoozeDueCheckpointRepository } from '../repositories/snooze-due-checkpoint.repository';
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

/** Called only by the separately reviewed private local harness entry. The
 * production scheduled export never dispatches this composition. */
export async function runFundedLocalSnoozeStep(env: Env, tenantId: string,
  purpose: 'new-work' | 'recovery', now: () => number = Date.now): Promise<
  Readonly<{ status: 'complete'; generation: number; outcome: 'no-snoozes' | 'empty' | 'resurfaced' }>
  | Readonly<{ status: 'recovery-needed' | 'paused'; reason: 'unknown' | 'admission-rejected' }>> {
  if (env.ENVIRONMENT !== 'local' || env.LOCAL_BETA_ENABLED !== 'true'
    || (purpose !== 'new-work' && purpose !== 'recovery')) return { status: 'paused', reason: 'admission-rejected' };
  const deps = createTenantRequestDeps(createSystemTenantScope({ tenantId, actor: 'scheduled-snooze-resurface' }),env);
  const repository = new SnoozeDueCheckpointRepository(deps.database,deps.scope);
  const read = await admitSnoozeDue({ env,deps,now,intent:{family:'read',input:{readId:crypto.randomUUID(),purpose}} });
  if (read.status !== 'admitted') return { status:'paused',reason:'admission-rejected' };
  let snapshot;
  try {
    if(read.intent.family !== 'read') throw new Error('Invalid local due read');
    snapshot = await repository.read(read.intent.input,read.authority);
    read.finish('committed');
  } catch {
    read.finish('unknown');
    return {status:purpose === 'recovery' ? 'paused' : 'recovery-needed',reason:'unknown'};
  }
  const generation = snapshot.checkpoint?.generation ?? 0;
  if(snapshot.activeSnoozes === 0) return {status:'complete',generation,outcome:'no-snoozes'};
  const advance = await admitSnoozeDue({env,deps,now,intent:{family:'advance',input:{expectedGeneration:generation,
    stepId:crypto.randomUUID(),dueThrough:new Date(now()).toISOString(),activeSnoozeSnapshot:snapshot.activeSnoozes}}});
  if(advance.status !== 'admitted') return {status:'paused',reason:'admission-rejected'};
  try {
    if(advance.intent.family !== 'advance') throw new Error('Invalid local due advance');
    const result = await repository.advance(advance.intent.input,advance.authority);
    advance.finish('committed');
    return {status:'complete',generation:result.generation,outcome:result.outcome};
  } catch {
    advance.finish('unknown');
    return {status:purpose === 'recovery' ? 'paused' : 'recovery-needed',reason:'unknown'};
  }
}
