export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
import { app } from '../src/application';
import { apiTicketBudgetCache } from '../src/middleware/budget-admission.middleware';
import { LocalAuthCaptureTransport } from '../src/services/email/transport';

const localCapture = new LocalAuthCaptureTransport();

let beforeWorkspaceBatch: string | undefined;
let beforeR2Get: string | undefined;
let beforeStateClear = false;
let workspaceBatches = 0;
let workspaceRowsRead = 0;
let workspaceRowsWritten = 0;
let r2Gets = 0;

async function applyAction(db: any, action: string | undefined) {
  if (!action) return;
  const statements: Record<string, string> = {
    session: "UPDATE users SET session_version=session_version+1 WHERE tenant_id='workspace-tenant' AND id='workspace-agent'",
    role: "UPDATE users SET role='customer' WHERE tenant_id='workspace-tenant' AND id='workspace-agent'",
    mfa: "UPDATE users SET mfa_enabled=0 WHERE tenant_id='workspace-tenant' AND id='workspace-agent'",
    membership: "DELETE FROM user_groups WHERE tenant_id='workspace-tenant' AND user_id='workspace-agent'",
    policy: "UPDATE budget_owner_policies SET policy_json=policy_json||' '",
    population: `INSERT INTO operator_drafts
      (tenant_id,user_id,ticket_id,generation,revision,mode,body,body_format,attachments,mentioned_user_ids,base_conversation_revision,expires_at)
      VALUES ('workspace-tenant','workspace-agent','population-race','00000000-0000-4000-a000-000000000098',1,'public','race','plain','[]','[]',0,NULL)`,
  };
  const sql = statements[action];
  if (!sql) throw new Error('Unknown synthetic workspace action');
  await db.prepare(sql).run();
}

function instrumentDatabase(db: any) {
  const statements = new WeakMap<object, { raw: any; sql: string }>();
  const wrap = (raw: any, sql: string): any => {
    const proxy = new Proxy(raw, { get(target, property) {
      if (property === 'bind') return (...values: any[]) => wrap(target.bind(...values), sql);
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    statements.set(proxy, { raw, sql });
    return proxy;
  };
  return new Proxy(db, { get(target, property) {
    if (property === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql);
    if (property === 'batch') return async (batch: any[]) => {
      const sql = batch.map(statement => statements.get(statement)?.sql ?? '');
      const workspace = sql.some(value => /operator_(drafts|workspace_state|theme_preference)/.test(value))
        && sql.some(value => value.includes('budget_mutation_assertion') || value.includes('SELECT 1 AS authorized'));
      if (beforeStateClear && sql.some(value => value.includes('UPDATE operator_workspace_state') && value.includes('selected_ticket_id=NULL'))) {
        beforeStateClear = false;
        await target.prepare("UPDATE operator_workspace_state SET revision=revision+1 WHERE tenant_id='workspace-tenant' AND user_id='workspace-agent'").run();
      }
      if (workspace && beforeWorkspaceBatch) {
        const action = beforeWorkspaceBatch;
        beforeWorkspaceBatch = undefined;
        await applyAction(target, action);
      }
      const results = await target.batch(batch.map(statement => statements.get(statement)?.raw ?? statement));
      if (workspace) {
        workspaceBatches++;
        workspaceRowsRead += results.reduce((total: number, result: any) => total + (result.meta?.rows_read ?? 0), 0);
        workspaceRowsWritten += results.reduce((total: number, result: any) => total + (result.meta?.rows_written ?? 0), 0);
      }
      return results;
    };
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

function instrumentBucket(bucket: any, db: any) {
  return new Proxy(bucket, { get(target, property) {
    if (property === 'get') return async (...args: any[]) => {
      r2Gets++;
      if (beforeR2Get) {
        const action = beforeR2Get;
        beforeR2Get = undefined;
        await applyAction(db, action);
      }
      return target.get(...args);
    };
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === '/__workspace-control') {
      if (request.method === 'POST') {
        const input = await request.json() as { beforeWorkspaceBatch?: string; beforeR2Get?: string; beforeStateClear?: boolean; reset?: boolean };
        if (input.reset) { workspaceBatches = 0; workspaceRowsRead = 0; workspaceRowsWritten = 0; r2Gets = 0; }
        if (input.beforeWorkspaceBatch) beforeWorkspaceBatch = input.beforeWorkspaceBatch;
        if (input.beforeR2Get) beforeR2Get = input.beforeR2Get;
        if (input.beforeStateClear) beforeStateClear = true;
      }
      return Response.json({ workspaceBatches, workspaceRowsRead, workspaceRowsWritten, r2Gets,
        cache: apiTicketBudgetCache.inspectForTrustedRuntime() });
    }
    const database = instrumentDatabase(env.DB);
    return app.fetch(request, { ...env, DB: database, ATTACHMENTS_BUCKET: instrumentBucket(env.ATTACHMENTS_BUCKET, env.DB),
      emailTransport: localCapture }, ctx);
  },
};
