export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
export { NotificationDO } from '../src/durable_objects/NotificationDO';
import { app } from '../src/application';
import { apiTicketBudgetCache } from '../src/middleware/budget-admission.middleware';

type Measurement = { path: string; calls: number; rowsRead: number; rowsWritten: number };
let wrappedDatabase: any, wrappedNamespace: any;
let beforeBatch: { kind: string } | undefined;
let active: Measurement | undefined;
const measurements: Measurement[] = [];

function record(meta: any) { if (active) { active.calls++; active.rowsRead += meta?.rows_read ?? 0; active.rowsWritten += meta?.rows_written ?? 0; } }

function instrumentDatabase(db: any): any {
  if (wrappedDatabase) return wrappedDatabase;
  const statements = new WeakMap<object, { raw: any; sql: string; values: any[] }>();
  const wrap = (raw: any, sql: string, values: any[] = []): any => {
    const proxy = new Proxy(raw, { get(target, property) {
      if (property === 'bind') return (...bound: any[]) => wrap(target.bind(...bound), sql, bound);
      if (property === 'first') return async (column?: string) => {
        const result = await target.all(); record(result.meta); const row = result.results?.[0] ?? null; return column && row ? row[column] : row;
      };
      if (property === 'all') return async (...args: any[]) => { const result = await target.all(...args); record(result.meta); return result; };
      if (property === 'run') return async (...args: any[]) => { const result = await target.run(...args); record(result.meta); return result; };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    statements.set(proxy, { raw, sql, values }); return proxy;
  };
  wrappedDatabase = new Proxy(db, { get(target, property) {
    if (property === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql);
    if (property === 'batch') return async (batch: any[]) => {
      const canonical = batch.some(statement => statements.get(statement)?.sql.includes('INSERT INTO budget_mutation_assertion'));
      if (canonical && beforeBatch) {
        const action = beforeBatch; beforeBatch = undefined;
        if (action.kind === 'closure') {
          const link = batch.map(statement => statements.get(statement)).find(statement => statement?.sql.includes('INSERT INTO budget_grant_operations'));
          if (!link) throw new Error('Synthetic API-key grant link was not prepared');
          const [tenantId, reservationId, holderId, operationId, aggregateId, fingerprint, envelope] = link.values;
          await target.batch([
            target.prepare(`INSERT OR IGNORE INTO budget_grant_operations
              (tenant_id,reservation_id,holder_id,operation_id,aggregate_id,operation_fingerprint,operation_envelope_json)
              VALUES (?,?,?,?,?,?,?)`).bind(tenantId, reservationId, holderId, operationId, aggregateId, fingerprint, envelope),
            target.prepare(`INSERT OR IGNORE INTO budget_grant_closures
              (tenant_id,reservation_id,holder_id,aggregate_id,terminal_evidence_id,operation_set_fingerprint,operation_count,measured_json,uncertain_json,expires_at)
              VALUES (?,?,?,?,?,?,1,'[]','[]',?)`).bind(tenantId, reservationId, holderId, aggregateId,
                `closed-${operationId}`, 'synthetic-closed-set', Date.now() + 60_000),
          ]);
        }
        if (action.kind === 'session') await target.prepare("UPDATE users SET session_version=session_version+1 WHERE tenant_id='key-tenant' AND id='00000000-0000-4000-8000-000000000001'").run();
        if (action.kind === 'mfa') await target.prepare("UPDATE users SET mfa_enabled=0 WHERE tenant_id='key-tenant' AND id='00000000-0000-4000-8000-000000000001'").run();
        if (action.kind === 'capability') await target.prepare("UPDATE deployment_capability_ceiling SET enabled=0,revision=revision+1 WHERE capability='api-keys.manage'").run();
        if (action.kind === 'growth') await target.prepare(`INSERT INTO api_keys(tenant_id,id,name,key_hash,prefix,permissions,is_active,created_at)
          VALUES('key-tenant','growth-key','Growth key','growth-hash','growth','tickets:read',1,'2030-01-01T00:00:00Z')`).run();
        if (action.kind === 'budget') await target.prepare("UPDATE budget_owner_policies SET policy_json=policy_json||' ' WHERE deployment_id='key-deployment'").run();
      }
      const results = await target.batch(batch.map(statement => statements.get(statement)?.raw ?? statement));
      for (const result of results) record(result.meta);
      return results;
    };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } });
  return wrappedDatabase;
}

function instrumentNamespace(namespace: any): any {
  if (wrappedNamespace) return wrappedNamespace;
  wrappedNamespace = { idFromName: (name: string) => namespace.idFromName(name), get: (id: any) => {
    const target = namespace.get(id); return {
      refreshFromTrustedAuthority: (input: any) => target.refreshFromTrustedAuthority(input),
      reserveFromTrustedAuthority: (input: any) => target.reserveFromTrustedAuthority(input),
      revokeFromTrustedAuthority: (input: any) => target.revokeFromTrustedAuthority(input),
      reconcileFromTrustedAuthority: (input: any) => target.reconcileFromTrustedAuthority(input),
    };
  } };
  return wrappedNamespace;
}

export default { async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/__api-key-control') {
    if (request.method === 'POST') {
      const control = await request.json() as { kind: string; discard?: boolean };
      if (control.discard) apiTicketBudgetCache.discardForTrustedRuntime();
      if (control.kind && control.kind !== 'discard') beforeBatch = control;
    }
    return Response.json({ measurements, cache: apiTicketBudgetCache.inspectForTrustedRuntime() });
  }
  active = { path, calls: 0, rowsRead: 0, rowsWritten: 0 };
  try { return await app.fetch(request, { ...env, DB: instrumentDatabase(env.DB),
    BUDGET_COORDINATOR_DO: instrumentNamespace(env.BUDGET_COORDINATOR_DO) }, ctx); }
  finally { measurements.push(active); active = undefined; }
} };
