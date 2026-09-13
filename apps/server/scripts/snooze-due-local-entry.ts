import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from '../src/bindings';
import { runFundedLocalSnoozeStep } from '../src/auth/automation-composition';
export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';

/** PRIVATE local harness worker only; never deployed/mounted on the app proxy.
 * Host service RPC is the sole callable transport; HTTP has no route. */
export default class LocalSnoozeEntrypoint extends WorkerEntrypoint<Env & { LOCAL_DUE_CATALOGUE: string }> {
  async fetch(): Promise<Response> { return new Response(null,{status:404}); }
  async runDue(tenantId: string, purpose: 'new-work' | 'recovery') {
    const parsed: unknown = JSON.parse(this.env.LOCAL_DUE_CATALOGUE);
    const catalogue = Array.isArray(parsed) ? Object.freeze([...parsed]) : null;
    if(!catalogue || !catalogue.every(id=>typeof id==='string' && id.length>0 && new TextEncoder().encode(id).byteLength<=160 && !/[\u0000-\u001f\u007f]/.test(id))
      || !catalogue.includes(tenantId) || new Set(catalogue).size!==catalogue.length) throw new Error('Invalid trusted due catalogue');
    return runFundedLocalSnoozeStep(this.env,tenantId,purpose);
  }
}
