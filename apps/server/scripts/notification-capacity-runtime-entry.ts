/** Synthetic local runtime instrumentation; never imported by the application Worker. */
import { NotificationDO } from '../src/durable_objects/NotificationDO';
import type { Env } from '../src/bindings';

export class NotificationCapacityFixture extends NotificationDO {
  private counts = { queries: 0, rowsRead: 0, sends: 0 };
  constructor(state: DurableObjectState, env: Env) {
    let record: (rows: number) => void = () => {};
    const db = env.DB;
    const observedDb = { prepare(sql: string) {
      return { bind(...values: unknown[]) {
        const statement = db.prepare(sql).bind(...values);
        return { async first() {
          const result = await statement.all(); record(result.meta.rows_read);
          return result.results[0] ?? null;
        } };
      } };
    } };
    super(state, { ...env, DB: observedDb } as Env);
    record = rows => { this.counts.queries++; this.counts.rowsRead += rows; };
  }
  override async send(ws: WebSocket, message: unknown): Promise<boolean> {
    this.counts.sends++;
    return super.send(ws, message);
  }
  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/fixture-counts') {
      return Response.json({ ...this.counts, registered: this.state.getWebSockets().length });
    }
    if (path === '/fixture-reset') { this.counts = { queries: 0, rowsRead: 0, sends: 0 }; return new Response('OK'); }
    if (path === '/fixture-seed') {
      // Seed an already-accepted/hibernated registry, including a legacy overcapacity case.
      // Actual boundary requests below always enter production NotificationDO.fetch.
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ connectionId: crypto.randomUUID(), userId: 'staff', name: 'Synthetic staff',
        location: null, tenantId: request.headers.get('X-Tenant-ID') ?? 'A', role: 'agent', version: 0,
        expiresAt: Math.floor(Date.now() / 1000) + 600 });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return super.fetch(request);
  }
}
