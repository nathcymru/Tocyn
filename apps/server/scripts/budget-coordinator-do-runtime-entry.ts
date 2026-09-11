export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';

/** No HTTP entry point: the runtime proof invokes trusted internal DO RPCs. */
export default {
  fetch(): Response {
    return new Response('Not found', { status: 404 });
  },
};

// Test-only wrapper preserves native storage exceptions across Miniflare's RPC proxy.
import { BudgetCoordinatorDO as Coordinator } from '../src/durable_objects/BudgetCoordinatorDO';
export class BudgetCoordinatorDiagnosticDO extends Coordinator {
  async persistLegacyObjectForTest() {
    await this.ctx.storage.put('budget-owner-aggregate-v1', await this.inspectForTrustedRuntime());
  }
  async persistLegacyStringForTest() {
    await this.ctx.storage.put('budget-owner-aggregate-v1', JSON.stringify(await this.inspectForTrustedRuntime()));
  }
  async inspectStoredValueForTest() {
    const value = await this.ctx.storage.get('budget-owner-aggregate-v1');
    return { kind: value instanceof Uint8Array ? 'utf8' : typeof value, bytes: value instanceof Uint8Array ? value.byteLength : typeof value === 'string' ? new TextEncoder().encode(value).byteLength : 0 };
  }
  async reconcileDiagnostic(input: Parameters<Coordinator['reconcileFromTrustedAuthority']>[0]) {
    try { return { outcome: await this.reconcileFromTrustedAuthority(input) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }
}
