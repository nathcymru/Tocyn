import { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export class ExpiredAccountingDiagnosticDO extends BudgetCoordinatorDO {
  async reserveWithFailingWrite(input: Parameters<BudgetCoordinatorDO['reserveFromTrustedAuthority']>[0]) {
    const storage = this.ctx.storage, original = storage.put;
    let writes = 0;
    storage.put = (() => { writes++; throw new Error('synthetic storage put failure'); }) as typeof storage.put;
    try { return { outcome: await this.reserveFromTrustedAuthority(input), writes }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error), writes }; }
    finally { storage.put = original; }
  }
}
export default { fetch() { return new Response('Not found', { status: 404 }); } };
