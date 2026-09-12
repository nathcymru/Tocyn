import { VectorizeWorkflow } from './workflows/vectorize.workflow';
import { Env } from './bindings';
import { EmailHandler } from './handlers/email.handler';
import { runScheduledRetention, runScheduledSnoozeResurface } from './auth/automation-composition';
import { runScheduledKnowledgeDeletion } from './auth/knowledge-delete-composition';
import { NotificationDO } from './durable_objects/NotificationDO';
import { BudgetCoordinatorDO } from './durable_objects/BudgetCoordinatorDO';
import { BudgetGrantHolderDO } from './durable_objects/BudgetGrantHolderDO';
import { app } from './application';

export { BudgetCoordinatorDO, BudgetGrantHolderDO, NotificationDO, VectorizeWorkflow };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.LOCAL_BETA_ENABLED !== undefined && env.LOCAL_BETA_ENABLED !== 'false') { message.setReject('Inbound email is disabled in the local beta'); return; }
    // Combined admission promises whole-entrypoint accounting. Email MIME and
    // provider work do not yet have the #51/#91 business envelope, so fail
    // before reading the message or resolving a tenant. Off-policy behavior is
    // preserved, and the guard can be removed when that acceptance is present.
    if (env.BUDGET_ADMISSION_POLICY === 'ticket-mutations-v1') {
      message.setReject('Inbound email admission is not available');
      return;
    }
    const handler = new EmailHandler(env);
    await handler.handleEmail(message, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.LOCAL_BETA_ENABLED !== undefined && env.LOCAL_BETA_ENABLED !== 'false' || env.ENVIRONMENT === 'preview' || env.ENVIRONMENT === 'beta') {
      console.warn('Scheduled work is disabled for isolated preview and beta environments');
      return;
    }
    const result = await runScheduledRetention(env);
    const knowledgeDeletion=await runScheduledKnowledgeDeletion(env);
    const snoozes = await runScheduledSnoozeResurface(env);
    console.log(`Retention run complete: ${result.deleted_tickets} tickets deleted, ${result.deleted_attachments} attachments deleted.`);
    console.log(`Knowledge deletion run complete: ${knowledgeDeletion.completed}/${knowledgeDeletion.attempted} bounded jobs completed.`);
    console.log(`Due snooze resurface complete: ${snoozes.resurfaced} tickets resurfaced, ${snoozes.failedTenants} tenant retries pending.`);
  },
};
