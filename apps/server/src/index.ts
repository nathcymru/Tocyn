import { VectorizeWorkflow } from './workflows/vectorize.workflow';
import { Env } from './bindings';
import { EmailHandler } from './handlers/email.handler';
import { runScheduledRetention } from './auth/automation-composition';
import { NotificationDO } from './durable_objects/NotificationDO';
import { app } from './application';

export { NotificationDO, VectorizeWorkflow };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.LOCAL_BETA_ENABLED !== undefined && env.LOCAL_BETA_ENABLED !== 'false') { message.setReject('Inbound email is disabled in the local beta'); return; }
    const handler = new EmailHandler(env);
    await handler.handleEmail(message, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.LOCAL_BETA_ENABLED !== undefined && env.LOCAL_BETA_ENABLED !== 'false' || env.ENVIRONMENT === 'preview' || env.ENVIRONMENT === 'beta') {
      console.warn('Scheduled work is disabled for isolated preview and beta environments');
      return;
    }
    const result = await runScheduledRetention(env);
    console.log(`Retention run complete: ${result.deleted_tickets} tickets deleted, ${result.deleted_attachments} attachments deleted.`);
  },
};
