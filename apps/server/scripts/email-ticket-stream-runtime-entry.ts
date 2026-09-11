/** Local-only streaming evidence. External delivery is replaced by a service-binding sink. */
import { HttpResendTransport } from '../src/services/email/transport';
import { TenantOutboundEmailService } from '../src/services/email/tenant-outbound.service';
import { TicketEmailBusyError } from '../src/services/email/ticket-stream';

let pending = 0;
export default { async fetch(request: Request, env: any): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/pending') return Response.json({ pending });
  const mode = url.searchParams.get('mode') ?? 'normal';
  const tenant = url.searchParams.get('tenant') ?? 'A';
  const count = Number(url.searchParams.get('count') ?? 2);
  const size = Number(url.searchParams.get('size') ?? 5);
  const metrics = { gets: 0, activeReaders: 0, peakReaders: 0, maxInput: 0, reads: 0, providerCalls: 0, arrayBuffers: 0 };
  let sink: any;
  const transport = new HttpResendTransport(async (_input, init) => {
    metrics.providerCalls++;
    if (mode === 'hold') pending++;
    const result = await env.SINK.fetch(new Request(`https://sink.test/${mode}`, init));
    if (mode === 'hold') pending--;
    if (result.ok && !['bad-response', 'large-response', 'response-stall'].includes(mode)) sink = await result.clone().json();
    return result;
  });
  const attachmentStorage = { async getAttachment(key: string) {
    metrics.gets++;
    if (mode === 'missing') return null;
    const actualKey = mode === 'short-body' || mode === 'long-body' ? mode : key;
    const object = await env.BUCKET.get(`${tenant}/${actualKey}`);
    if (!object) return null;
    const actualBody = mode === 'unsupported' ? new ReadableStream({ start(controller) { controller.close(); } }) : object.body;
    const body = new Proxy(actualBody, { get(target, property) {
      if (property === 'getReader') return (options: any) => {
        const reader = target.getReader(options); metrics.activeReaders++; metrics.peakReaders = Math.max(metrics.peakReaders, metrics.activeReaders);
        let released = false;
        return new Proxy(reader, { get(targetReader, name) {
          if (name === 'readAtLeast') return async (...args: any[]) => {
            if (mode === 'read-error') throw new Error('private reader failure');
            metrics.reads++; metrics.maxInput = Math.max(metrics.maxInput, args[1].byteLength);
            return targetReader.readAtLeast(...args);
          };
          if (name === 'releaseLock') return () => { if (!released) { released = true; metrics.activeReaders--; } targetReader.releaseLock(); };
          const value = Reflect.get(targetReader, name); return typeof value === 'function' ? value.bind(targetReader) : value;
        } });
      };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    return { size: mode === 'metadata' ? object.size + 1 : ['short-body', 'long-body'].includes(mode) ? size : object.size,
      httpMetadata: object.httpMetadata, body,
      arrayBuffer: () => { metrics.arrayBuffers++; throw new Error('buffered path forbidden'); } };
  } };
  const deps = { repositories: { config: { get: async () => '#' },
    channels: { findReplySender: async () => null, findByEmail: async () => null } }, attachmentStorage };
  // Synthetic credentials are supplied by the test-only composition. Production
  // credential loading and ownership checks remain covered by service regressions.
  class FixtureService extends TenantOutboundEmailService {
    override async getResendCredentials() { return { apiKey: 'synthetic-no-provider-key', defaultFrom: 'support@example.test' }; }
  }
  const service = new FixtureService(deps as any, undefined, transport, 'test');
  try {
    await service.sendTicketReply({ id: 'ticket', ticket_no: 1, subject: 'Subject 漢😀', customer_email: 'customer@example.test' } as any,
      { body: 'Text " quoted\n\\ and 😀' } as any,
      Array.from({ length: count }, (_, index) => ({ r2_key: `file-${index}`, file_name: `file-${index}.txt`, file_size: size, content_type: 'text/plain' })) as any);
    return Response.json({ outcome: 'accepted', metrics, sink });
  } catch (error) {
    return Response.json({ outcome: error instanceof TicketEmailBusyError ? 'busy' : 'failed', metrics, message: (error as Error).message });
  }
} };
