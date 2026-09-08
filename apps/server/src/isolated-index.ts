import { Env } from './bindings';
import { NotificationDO } from './durable_objects/NotificationDO';
import { EmailHandler } from './handlers/email.handler';
import { validIsolatedRuntime } from './middleware/environment-guard';
import { app } from './application';

export { NotificationDO };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!validIsolatedRuntime(env)) return new Response('Isolated environment configuration is invalid', { status: 503 });
    return app.fetch(request, env, ctx);
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!validIsolatedRuntime(env)) {
      message.setReject('Inbound email is not enabled');
      return;
    }
    await new EmailHandler(env).handleEmail(message, ctx);
  },

  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
    console.warn('Scheduled work is disabled for isolated preview and beta environments');
  }
};
