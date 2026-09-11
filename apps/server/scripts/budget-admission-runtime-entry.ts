export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
export { NotificationDO } from '../src/durable_objects/NotificationDO';
import { app } from '../src/application';
import { apiTicketBudgetCache } from '../src/middleware/budget-admission.middleware';
import { BroadcastService } from '../src/services/broadcast.service';
import { LocalAuthCaptureTransport } from '../src/services/email/transport';

let wrappedNamespace: any;
let wrappedDatabase: any;
let beforeCanonical: string | undefined;
let afterSlaPolicyCommit: string | undefined;
let afterSupportStateCommit: { tenantId: string; id: string; label: string } | undefined;
let canonicalDelayMs = 0;
let pauseNextCanonical = false;
let releaseCanonical: (() => void) | undefined;
let loseCanonicalAck = false;
let failCanonicalAttempts = 0;
let rollbackNextCanonical = false;
let forcedRollbackCanonicalAttempts = 0;
let nextMutationReceiptWinner: any;
let canonicalAttempts = 0;
const canonicalBatches: { statements: number; rowsRead: number; rowsWritten: number }[] = [];
let r2Gets = 0;
let r2Puts = 0;
let loseR2PutAcknowledgement = false;
let notificationBroadcasts = 0;
let historyEventQueries = 0;
let historyEventRowsRead = 0;
let historyRowsRead = 0;
let detailArticleMetadataQueries = 0;
let detailArticleRowsRead = 0;
let detailAttachmentMetadataQueries = 0;
let detailAttachmentRowsRead = 0;
let detailReferenceRowsRead = 0;
let revokeApiKeyAfterAuth: { tenantId: string; apiKeyId: string } | undefined;
const localCapture = new LocalAuthCaptureTransport();
const broadcast = BroadcastService.prototype.broadcast;
BroadcastService.prototype.broadcast = async function(...args) {
  notificationBroadcasts++;
  return broadcast.apply(this, args);
};
function instrumentBucket(bucket: any): any {
  if (!bucket) return bucket;
  return new Proxy(bucket, { get(target, property) {
    if (property === 'get') return async (...args: any[]) => { r2Gets++; return target.get(...args); };
    if (property === 'put') return async (...args: any[]) => {
      r2Puts++;
      const result = await target.put(...args);
      if (loseR2PutAcknowledgement) { loseR2PutAcknowledgement = false; throw new Error('synthetic lost R2 put acknowledgement'); }
      return result;
    };
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
        if (revokeApiKeyAfterAuth && sql.includes('SELECT tenant_id, id, name, permissions FROM api_keys WHERE key_hash')) {
          const key = revokeApiKeyAfterAuth; revokeApiKeyAfterAuth = undefined;
          await db.prepare('UPDATE api_keys SET is_active=0 WHERE tenant_id=? AND id=?').bind(key.tenantId, key.apiKeyId).run();
        }
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
      if (property==='all') return async (...args:any[]) => {
        const result = await target.all(...args);
        if (sql.includes('length(CAST(COALESCE(a.body')) {
          detailArticleMetadataQueries++;
          detailArticleRowsRead += result.meta?.rows_read ?? 0;
        }
        if (sql.includes('length(CAST(x.file_name AS BLOB))')) detailAttachmentMetadataQueries++;
        if (sql.includes('SELECT x.* FROM attachments x')) detailAttachmentRowsRead += result.meta?.rows_read ?? 0;
        if (sql.includes("SELECT e.id,e.article_id,e.kind FROM conversation_events e") || sql.includes("SELECT id,article_id,kind FROM conversation_events")) detailReferenceRowsRead += result.meta?.rows_read ?? 0;
        if (sql.includes('SELECT e.* FROM conversation_events e') || sql.includes('SELECT e.* FROM conversation_public_history p')) {
          historyEventQueries++;
          historyEventRowsRead += result.meta?.rows_read ?? 0;
        }
        if (sql.includes('SELECT e.* FROM conversation_events e') || sql.includes('SELECT e.* FROM conversation_public_history p') || sql.includes('SELECT id FROM articles')) {
          historyRowsRead += result.meta?.rows_read ?? 0;
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
        if (pauseNextCanonical) {
          pauseNextCanonical = false;
          let released = false; releaseCanonical = () => { released = true; };
          for (let tick = 0; tick < 500 && !released; tick++) await new Promise(resolve => setTimeout(resolve, 10));
          releaseCanonical = undefined;
          if (!released) throw new Error('Synthetic canonical gate timed out');
        }
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
        if (action==='closedLinkedGrant') {
          // Model a retained operation from an earlier attempt whose whole
          // reservation became terminal before this business transaction.
          const linked=batch.find(statement=>statements.get(statement)?.sql.includes('INSERT INTO budget_grant_operations'));
          if (!linked) throw new Error('Synthetic closure needs the exact operation');
          await statements.get(linked)!.raw.run();
          await target.prepare(`INSERT OR IGNORE INTO budget_grant_closures
            (tenant_id,reservation_id,holder_id,aggregate_id,terminal_evidence_id,operation_set_fingerprint,operation_count,measured_json,uncertain_json)
            SELECT tenant_id,reservation_id,holder_id,aggregate_id,reservation_id,'synthetic-closed',1,'{}','{}'
            FROM budget_grant_operations WHERE tenant_id='runtime-tenant'`).run();
        }
        if (action==='failure') throw new Error('Synthetic canonical interruption');
        if (action && actions[action]) await target.prepare(actions[action]).run();
        const delay=canonicalDelayMs;canonicalDelayMs=0;if (delay) await new Promise(resolve=>setTimeout(resolve,delay));
      }
      const nativeBatch=batch.map(statement=>statements.get(statement)?.raw??statement);
      if (canonical && rollbackNextCanonical) {
        rollbackNextCanonical = false;
        // This final duplicate runs after the entire native business batch and
        // makes D1 roll it all back. It is test-only and never reaches app SQL.
        nativeBatch.push(target.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
          SELECT tenant_id,accepted FROM budget_mutation_assertion LIMIT 1`));
        try { await target.batch(nativeBatch); }
        catch (error) { forcedRollbackCanonicalAttempts++; throw error; }
        throw new Error('Synthetic forced canonical rollback unexpectedly committed');
      }
      const results=await target.batch(nativeBatch);
      batch.forEach((statement, index) => {
        const sql = statements.get(statement)?.sql ?? '';
        if (sql.includes('SELECT e.id,e.article_id,e.kind FROM conversation_events e') || sql.includes('SELECT id,article_id,kind FROM conversation_events'))
          detailReferenceRowsRead += results[index].meta?.rows_read ?? 0;
      });
      if (canonical) {
        canonicalBatches.push({statements:results.length,rowsRead:results.reduce((n:number,r:any)=>n+r.meta.rows_read,0),rowsWritten:results.reduce((n:number,r:any)=>n+r.meta.rows_written,0)});
        if (afterSlaPolicyCommit) {
          const tenant=afterSlaPolicyCommit; afterSlaPolicyCommit=undefined;
          await target.prepare('UPDATE sla_policies SET response_target_ms=90000,revision=revision+1 WHERE tenant_id=?').bind(tenant).run();
        }
        if (afterSupportStateCommit) {
          const edit=afterSupportStateCommit; afterSupportStateCommit=undefined;
          await target.prepare('UPDATE support_state_definitions SET public_label=? WHERE tenant_id=? AND id=?').bind(edit.label,edit.tenantId,edit.id).run();
        }
        if (loseCanonicalAck) {loseCanonicalAck=false;throw new Error('Synthetic lost canonical acknowledgement');}
      }
      return results;
    };
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});return wrappedDatabase;
}

let clock: number | undefined;
let lostReserveAcksRemaining = 0;
let lostReconcileAcksRemaining = 0;
let editPolicyAfterReserve = false;
let pauseNextReserve = false;
let releaseReserve: (()=>void)|undefined;
const calls = { refresh: 0, reserve: 0, revoke: 0, reconcile: 0 };
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
        reconcileFromTrustedAuthority: async (input: any) => {
          calls.reconcile++;
          const result = await target.reconcileFromTrustedAuthority(input);
          if (lostReconcileAcksRemaining > 0) { lostReconcileAcksRemaining--; throw new Error('synthetic lost reconciliation acknowledgement'); }
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
        const control = await request.json() as { afterSlaPolicyCommit?: string; afterSupportStateCommit?: { tenantId: string; id: string; label: string }; pauseNextCanonical?: boolean; releaseCanonical?: boolean; discard?: boolean; now?: number; loseReserveAck?: boolean; loseReserveAcks?: number; loseReconcileAcks?: number; beforeCanonical?: string; canonicalDelayMs?: number; loseCanonicalAck?: boolean; loseR2PutAcknowledgement?: boolean; failCanonicalAttempts?: number; editPolicyAfterReserve?: boolean; pauseNextReserve?: boolean; releaseReserve?: boolean; receiptWinner?: unknown; rollbackNextCanonical?: boolean; revokeApiKeyAfterAuth?: { tenantId?: unknown; apiKeyId?: unknown } };
        if (control.pauseNextCanonical) pauseNextCanonical = true;
        if (control.releaseCanonical) releaseCanonical?.();
        if (control.pauseNextReserve) pauseNextReserve=true;
        if (control.releaseReserve) releaseReserve?.();
        if (control.receiptWinner) nextMutationReceiptWinner=control.receiptWinner;
        if (control.rollbackNextCanonical) rollbackNextCanonical=true;
        if (control.editPolicyAfterReserve) editPolicyAfterReserve=true;
        if (control.failCanonicalAttempts && control.failCanonicalAttempts<=5) failCanonicalAttempts=control.failCanonicalAttempts;
        if (control.beforeCanonical) beforeCanonical=control.beforeCanonical;
        if (control.afterSlaPolicyCommit) afterSlaPolicyCommit=control.afterSlaPolicyCommit;
        if (control.afterSupportStateCommit) afterSupportStateCommit=control.afterSupportStateCommit;
        if (control.canonicalDelayMs && control.canonicalDelayMs<=1500) canonicalDelayMs=control.canonicalDelayMs;
        if (control.loseCanonicalAck) loseCanonicalAck=true;
        if (control.loseR2PutAcknowledgement) loseR2PutAcknowledgement=true;
        if (typeof control.revokeApiKeyAfterAuth?.tenantId === 'string' && typeof control.revokeApiKeyAfterAuth.apiKeyId === 'string') {
          revokeApiKeyAfterAuth = { tenantId: control.revokeApiKeyAfterAuth.tenantId, apiKeyId: control.revokeApiKeyAfterAuth.apiKeyId };
        }
        if (control.discard) apiTicketBudgetCache.discardForTrustedRuntime();
        if (control.now !== undefined) clock = control.now;
        if (control.loseReserveAck) lostReserveAcksRemaining = 1;
        if (control.loseReserveAcks === 2) lostReserveAcksRemaining = 2;
        if (control.loseReconcileAcks && control.loseReconcileAcks <= 5) lostReconcileAcksRemaining = control.loseReconcileAcks;
      }
      return Response.json({ calls, canonicalBatches, canonicalAttempts, forcedRollbackCanonicalAttempts, r2Gets, r2Puts, notificationBroadcasts,
        historyEventQueries, historyEventRowsRead, historyRowsRead, detailArticleMetadataQueries, detailArticleRowsRead,
        detailAttachmentMetadataQueries, detailAttachmentRowsRead, detailReferenceRowsRead, reservePaused:!!releaseReserve, canonicalPaused:!!releaseCanonical,
        cache: apiTicketBudgetCache.inspectForTrustedRuntime() });
    }
    return await app.fetch(request, { ...env, DB: instrumentDatabase(env.DB), ATTACHMENTS_BUCKET: instrumentBucket(env.ATTACHMENTS_BUCKET), emailTransport: localCapture,
      BUDGET_COORDINATOR_DO: instrument(env.BUDGET_COORDINATOR_DO, env.DB),
      localNow: () => clock ?? Date.now() }, ctx);
  },
};
