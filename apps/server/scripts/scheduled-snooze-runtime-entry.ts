import productionWorker from '../src/index';

// Miniflare dispatches fetch events through its public test API. This adapter
// invokes the exact production scheduled export inside that deployed bundle;
// it does not call a repository or scheduler composition directly.
export default {
  ...productionWorker,
  async fetch(request: Request, env: Parameters<typeof productionWorker.fetch>[1], ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === '/__scheduled-snooze-trigger') {
      await productionWorker.scheduled({ cron: '* * * * *', scheduledTime: Date.now() } as ScheduledEvent, env, ctx);
      return new Response(null, { status: 204 });
    }
    return productionWorker.fetch(request, env, ctx);
  },
};
