export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
import { app } from '../src/application';

export default {
  fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};
