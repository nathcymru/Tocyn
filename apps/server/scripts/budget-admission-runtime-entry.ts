export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
import { app } from '../src/application';

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    return await app.fetch(request, env, ctx);
  },
};
