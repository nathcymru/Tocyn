export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
import { app } from '../src/application';
import { apiTicketBudgetCache } from '../src/middleware/budget-admission.middleware';
import { LocalAuthCaptureTransport } from '../src/services/email/transport';

let wrappedNamespace: any;
let wrappedDatabase: any;
let beforeCanonical: string | undefined;
let canonicalDelayMs = 0;
let loseCanonicalAck = false;
let failCanonicalAttempts = 0;
let nextMutationReceiptWinner: any;
let canonicalAttempts = 0;
const canonicalBatches: { statements: number; rowsRead: number; rowsWritten: number }[] = [];
let r2Gets = 0;
const localCapture = new LocalAuthCaptureTransport();
function instrumentBucket(bucket: any): any {
  if (!bucket) return bucket;
  return new Proxy(bucket, { get(target, property) {
    if (property === 'get') return async (...args: any[]) => { r2Gets++; return target.get(...args); };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  }});
}
function instrumentDatabase(db: any): any {
  if (wrappedDatabase) return wrappedDatabase;
  const statements = new WeakMap<object,{ raw:any; sql:string }>();
  const wrap = (raw:any,sql:string):any => {
    const proxy = new Proxy(raw,{get(target,property) {
      if (property==='bind') return (...values:any[])=>wrap(target.bind(...values),sql);
      if (property==='first') return async (...args:any[]) => {
        // A local competing canonical winner commits after this lookup has
        // observed null, then the caller continues into admission.
        const result = await target.first(...args);
        if (nextMutationReceiptWinner && sql.includes('SELECT * FROM ticket_mutation_receipts')) {
          const winner=nextMutationReceiptWinner;nextMutationReceiptWinner=undefined;
          await db.batch([
            db.prepare(`INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_id,customer_email,source)
              VALUES (?,?,?,?,?,?,?,?)`).bind(winner.tenantId,winner.ticket.id,winner.ticket.subject,'open','normal',winner.principalId,winner.ticket.customer_email,'widget'),
            db.prepare(`INSERT INTO articles (tenant_id,id,ticket_id,sender_id,sender_type,body,is_internal,intake_source)
              VALUES (?,?,?,?,?,?,0,'widget')`).bind(winner.tenantId,winner.article.id,winner.ticket.id,winner.principalId,'customer',winner.article.body),
            db.prepare(`INSERT INTO ticket_mutation_receipts
              (tenant_id,principal_kind,principal_id,operation,key_hash,payload_hash,fingerprint_version,response_version,
               result_ticket_id,result_article_id,response_status,response_snapshot)
              VALUES (?,'customer',?,?,?, ?,1,1,?,?,201,?)`)
              .bind(winner.tenantId,winner.principalId,winner.operation,winner.keyHash,winner.payloadHash,winner.ticket.id,winner.article.id,winner.snapshot),
          ]);
        }
        return result;
      };
      const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
    }}); statements.set(proxy,{raw,sql});return proxy;
  };
  wrappedDatabase = new Proxy(db,{get(target,property) {
    if (property==='prepare') return (sql:string)=>wrap(target.prepare(sql),sql);
    if (property==='batch') return async (batch:any[])=>{
      const canonical=batch.some(statement=>statements.get(statement)?.sql.includes('INSERT INTO budget_mutation_assertion'));
      if (canonical) {
        canonicalAttempts++;
        if (failCanonicalAttempts>0) {failCanonicalAttempts--;throw new Error('Synthetic bounded canonical interruption');}
        const action=beforeCanonical;beforeCanonical=undefined;
        const actions:Record<string,string>={
          authority:"UPDATE budget_deployment_authority SET state='revoked'",
          policy:"UPDATE budget_owner_policies SET policy_json=json_set(policy_json,'$.budgets[0].limit',999)",
          window:"UPDATE budget_owner_policies SET policy_json=json_set(policy_json,'$.budgets[0].window.id','changed')",
          restriction:"UPDATE budget_tenant_allocations SET restriction_json=json_set(restriction_json,'$.disabledFeatures',json('[\"changed\"]')) WHERE tenant_id='runtime-tenant'",
          key:"UPDATE api_keys SET is_active=0 WHERE tenant_id='runtime-tenant' AND id='runtime-key'",
          permission:"UPDATE api_keys SET permissions='tickets:read' WHERE tenant_id='runtime-tenant' AND id='runtime-key'",
          customerSession:"UPDATE users SET session_version=2 WHERE tenant_id='runtime-tenant' AND id='runtime-customer'",
        };
        if (action==='failure') throw new Error('Synthetic canonical interruption');
        if (action && actions[action]) await target.prepare(actions[action]).run();
        const delay=canonicalDelayMs;canonicalDelayMs=0;if (delay) await new Promise(resolve=>setTimeout(resolve,delay));
      }
      const results=await target.batch(batch.map(statement=>statements.get(statement)?.raw??statement));
      if (canonical) {
        canonicalBatches.push({statements:results.length,rowsRead:results.reduce((n:number,r:any)=>n+r.meta.rows_read,0),rowsWritten:results.reduce((n:number,r:any)=>n+r.meta.rows_written,0)});
        if (loseCanonicalAck) {loseCanonicalAck=false;throw new Error('Synthetic lost canonical acknowledgement');}
      }
      return results;
    };
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});return wrappedDatabase;
}

let clock: number | undefined;
let lostReserveAcksRemaining = 0;
let editPolicyAfterReserve = false;
let pauseNextReserve = false;
let releaseReserve: (()=>void)|undefined;
const calls = { refresh: 0, reserve: 0, revoke: 0 };
function instrument(namespace: any, db: any): any {
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
          if (pauseNextReserve && result.status === 'granted') {
            pauseNextReserve = false;
            // Native timer work keeps this synthetic request alive; a bare
            // promise with no Worker I/O would be rejected as a hung request.
            let released=false;releaseReserve=()=>{released=true;};
            for(let tick=0;tick<200&&!released;tick++)await new Promise(resolve=>setTimeout(resolve,10));
            releaseReserve=undefined;
            if(!released)throw new Error('Synthetic reservation gate timed out');
          }
          if (editPolicyAfterReserve && result.status === 'granted') {
            editPolicyAfterReserve = false;
            await db.prepare("UPDATE budget_owner_policies SET policy_json=policy_json||' '").run();
          }
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
        const control = await request.json() as { discard?: boolean; now?: number; loseReserveAck?: boolean; loseReserveAcks?: number; beforeCanonical?: string; canonicalDelayMs?: number; loseCanonicalAck?: boolean; failCanonicalAttempts?: number; editPolicyAfterReserve?: boolean; pauseNextReserve?: boolean; releaseReserve?: boolean; receiptWinner?: unknown };
        if (control.pauseNextReserve) pauseNextReserve=true;
        if (control.releaseReserve) releaseReserve?.();
        if (control.receiptWinner) nextMutationReceiptWinner=control.receiptWinner;
        if (control.editPolicyAfterReserve) editPolicyAfterReserve=true;
        if (control.failCanonicalAttempts && control.failCanonicalAttempts<=5) failCanonicalAttempts=control.failCanonicalAttempts;
        if (control.beforeCanonical) beforeCanonical=control.beforeCanonical;
        if (control.canonicalDelayMs && control.canonicalDelayMs<=1500) canonicalDelayMs=control.canonicalDelayMs;
        if (control.loseCanonicalAck) loseCanonicalAck=true;
        if (control.discard) apiTicketBudgetCache.discardForTrustedRuntime();
        if (control.now !== undefined) clock = control.now;
        if (control.loseReserveAck) lostReserveAcksRemaining = 1;
        if (control.loseReserveAcks === 2) lostReserveAcksRemaining = 2;
      }
      return Response.json({ calls, canonicalBatches, canonicalAttempts, r2Gets, reservePaused:!!releaseReserve, cache: apiTicketBudgetCache.inspectForTrustedRuntime() });
    }
    return await app.fetch(request, { ...env, DB: instrumentDatabase(env.DB), ATTACHMENTS_BUCKET: instrumentBucket(env.ATTACHMENTS_BUCKET), emailTransport: localCapture,
      BUDGET_COORDINATOR_DO: instrument(env.BUDGET_COORDINATOR_DO, env.DB),
      localNow: () => clock ?? Date.now() }, ctx);
  },
};
