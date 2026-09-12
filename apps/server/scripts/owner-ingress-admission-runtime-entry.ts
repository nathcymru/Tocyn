export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';

import { Hono } from 'hono';
import type { Env } from '../src/bindings';
import type { AppVariables } from '../src/types';
import { ownerIngressAdmission } from '../src/middleware/owner-ingress-admission';
import { IsolateBudgetAdmissionCache } from '../src/budgets/isolate-admission.service';
import productionWorker from '../src/index';
import { authMiddleware } from '../src/middleware/auth.middleware';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
const tenantCache = new IsolateBudgetAdmissionCache();
app.use('*', ownerIngressAdmission);

app.get('/api/owner-only', c => c.json({ error: 'Unauthorized' }, 401));
app.get('/unverified-owner-only', c => c.json({ error: 'Unauthorized' }, 401));
app.get('/health', c => c.text('OK'));
app.post('/api/auth/logout', c => c.json({ error: 'Unauthorized' }, 401));
app.post('/api/handoff', authMiddleware, async c => {
  // The request query is deliberately ignored: the signed current principal
  // and its D1 membership select the tenant.
  const scope = c.get('tenantScope')!;
  const deps = c.get('tenantDeps')!;
  // Optional deterministic identity exists only in this synthetic runtime.
  const operationId = c.req.query('operation') ?? crypto.randomUUID();
  const result = await tenantCache.admit({ repository: deps.repositories.budgetAuthority,
    namespace: c.env.BUDGET_COORDINATOR_DO,
    authorization: { authorize: async () => ({ kind: 'session' as const, sessionVersion: 1 }) },
    scope, credentialKey: 'staff:actor-a:1',
    intent: { operationId, operationFingerprint: operationId, workScopeKey: 'native.owner-ingress.handoff' },
    business: { workerRequests: 1, d1RowsWritten: 1 }, now: c.env.localNow ?? Date.now });
  const link=result.commitAuthority?.grant;
  if(result.status==='spent'&&link)await c.env.DB.prepare(`INSERT INTO budget_grant_operations
    (tenant_id,reservation_id,holder_id,operation_id,aggregate_id,operation_fingerprint,operation_envelope_json)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`).bind(link.tenantId,link.reservationId,link.holderId,link.operationId,link.aggregateId,
      link.operationFingerprint,JSON.stringify(link.operationEnvelope)).run();
  return c.json(result, result.status === 'spent' || result.status === 'idempotent' ? 200 : 503);
});
app.get('/email-readiness-guard', async c => {
  let rejection: string | undefined;
  await productionWorker.email({ setReject: (reason: string) => { rejection = reason; } } as ForwardableEmailMessage, c.env, {} as ExecutionContext);
  return c.json({ rejection });
});

export default app;
