export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
export { NotificationDO } from '../src/durable_objects/NotificationDO';
import { app } from '../src/application';
import { apiTicketBudgetCache } from '../src/middleware/budget-admission.middleware';

let aiCalls = 0, vectorQueries = 0, r2Gets = 0, failAi = false;
const embeddingInputs: string[] = [];
const generationInputBytes: number[] = [];
const vector = { query: async () => {
  vectorQueries++;
  return { matches: [{ score: 1, metadata: { source_id: 'public-doc', type: 'document', tier: 'answer', status: 'published', text: 'Public answer' } }] };
} };
const ai = { run: async (model: string, input: { text?: string[] }) => {
  aiCalls++;
  if (failAi) { failAi = false; throw new Error('synthetic AI failure'); }
  if (model.includes('bge-large')) embeddingInputs.push(input.text?.[0] ?? '');
  else generationInputBytes.push(new TextEncoder().encode(JSON.stringify(input)).byteLength);
  return model.includes('bge-large') ? { data: [Array.from({ length: 1024 }, () => 0)] } : { response: 'Synthetic answer' };
} };
function bucket(value: any) {
  return new Proxy(value, { get(target, property) {
    if (property === 'get') return async (...args: any[]) => { r2Gets++; return target.get(...args); };
    const member = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
  } });
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === '/__http-ai-control') {
      if (request.method === 'POST') {
        const body = await request.json() as { failAi?: boolean; reset?: boolean };
        if (body.reset) { aiCalls = 0; vectorQueries = 0; r2Gets = 0; embeddingInputs.length = 0; generationInputBytes.length = 0; }
        if (body.failAi) failAi = true;
      }
      return Response.json({ aiCalls, vectorQueries, r2Gets, embeddingInputs, generationInputBytes, cache: apiTicketBudgetCache.inspectForTrustedRuntime() });
    }
    return app.fetch(request, { ...env, AI: ai, VECTOR_INDEX: vector, ATTACHMENTS_BUCKET: bucket(env.ATTACHMENTS_BUCKET) }, ctx);
  },
};
