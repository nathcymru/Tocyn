/** Disposable native instrumentation for #64 realtime lease proof only. */
import { NotificationDO } from '../src/durable_objects/NotificationDO';
import type { Env } from '../src/bindings';
import { app } from '../src/application';

export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';

let clock: number | undefined;

export class RealtimeAdmissionFixture extends NotificationDO {
  private readonly fixtureEnv: Env;
  constructor(state: DurableObjectState, env: Env) {
    super(state, { ...env, localNow: () => clock ?? Date.now() });
    this.fixtureEnv = { ...env, localNow: () => clock ?? Date.now() };
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/fixture-fetch-count') {
      return Response.json({ fetches: await this.state.storage.get<number>('fixture:fetches') ?? 0 });
    }
    if (url.pathname === '/fixture-clock' && request.method === 'POST') {
      const body = await request.json() as { now?: unknown };
      if (typeof body.now === 'number' && Number.isSafeInteger(body.now) && body.now >= 0) clock = body.now;
      return new Response('OK');
    }
    if (url.pathname === '/fixture-reconstruct') {
      await new NotificationDO(this.state, this.fixtureEnv).alarm();
      return new Response('OK');
    }
    if (url.pathname === '/fixture-lease-count') {
      const index = await this.state.storage.get<unknown>('realtime:lease-index:v1');
      return Response.json({ leases: Array.isArray(index) ? index.length : -1 });
    }
    if (url.pathname === '/fixture-receipt-burst' && request.method === 'POST') {
      const body = await request.json() as { count?: unknown; expiresAt?: unknown };
      const count = body.count, expiresAt = body.expiresAt;
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 1_024
        || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt)) return new Response('Invalid fixture receipt burst', { status: 400 });
      await this.state.storage.put('realtime:lease-receipts:v1', Array.from({ length: count }, (_, index) => [`${index}`.padStart(64, 'f'), expiresAt]));
      return new Response('OK');
    }
    await this.state.storage.put('fixture:fetches', (await this.state.storage.get<number>('fixture:fetches') ?? 0) + 1);
    return super.fetch(request);
  }
}

/** The second native proof enters through the configured Worker route. */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return await app.fetch(request, env, ctx);
  },
};
