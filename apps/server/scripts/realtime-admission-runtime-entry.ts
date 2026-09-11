/** Disposable native instrumentation for #64 realtime lease proof only. */
import { NotificationDO } from '../src/durable_objects/NotificationDO';
import type { Env } from '../src/bindings';

let clock: number | undefined;

export class RealtimeAdmissionFixture extends NotificationDO {
  private readonly fixtureEnv: Env;
  constructor(state: DurableObjectState, env: Env) {
    super(state, { ...env, localNow: () => clock ?? Date.now() });
    this.fixtureEnv = { ...env, localNow: () => clock ?? Date.now() };
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
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
    return super.fetch(request);
  }
}
