export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';

/** No HTTP entry point: the runtime proof invokes trusted internal DO RPCs. */
export default {
  fetch(): Response {
    return new Response('Not found', { status: 404 });
  },
};
