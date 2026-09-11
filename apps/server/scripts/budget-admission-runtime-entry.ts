export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
import { app } from '../src/application';
import { apiTicketBudgetCache } from '../src/middleware/budget-admission.middleware';

let wrappedNamespace: any;
let clock: number | undefined;
let lostReserveAcksRemaining = 0;
const calls = { refresh: 0, reserve: 0, revoke: 0 };
function instrument(namespace: any): any {
  if (wrappedNamespace) return wrappedNamespace;
  wrappedNamespace = {
    idFromName: (name: string) => namespace.idFromName(name),
    get: (id: any) => {
      const target = namespace.get(id);
      return {
        refreshFromTrustedAuthority: async (input: any) => { calls.refresh++; return target.refreshFromTrustedAuthority(input); },
        revokeFromTrustedAuthority: async (input: any) => { calls.revoke++; return target.revokeFromTrustedAuthority(input); },
        reserveFromTrustedAuthority: async (input: any) => {
          calls.reserve++;
          const result = await target.reserveFromTrustedAuthority(input);
          if (lostReserveAcksRemaining > 0 && (result.status === 'granted' || result.status === 'idempotent')) {
            lostReserveAcksRemaining--;
            throw new Error('synthetic lost committed allocation acknowledgement');
          }
          return result;
        },
      };
    },
  };
  return wrappedNamespace;
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === '/__budget-control') {
      if (request.method === 'POST') {
        const control = await request.json() as { discard?: boolean; now?: number; loseReserveAck?: boolean; loseReserveAcks?: number };
        if (control.discard) apiTicketBudgetCache.discardForTrustedRuntime();
        if (control.now !== undefined) clock = control.now;
        if (control.loseReserveAck) lostReserveAcksRemaining = 1;
        if (control.loseReserveAcks === 2) lostReserveAcksRemaining = 2;
      }
      return Response.json({ calls, cache: apiTicketBudgetCache.inspectForTrustedRuntime() });
    }
    return await app.fetch(request, { ...env, BUDGET_COORDINATOR_DO: instrument(env.BUDGET_COORDINATOR_DO),
      localNow: () => clock ?? Date.now() }, ctx);
  },
};
