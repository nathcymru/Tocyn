import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import { KNOWLEDGE_SOURCE_MAX_BYTES } from '../budgets/knowledge-source-admission.service';
import type { SessionBudgetCredential } from './session-budget-authority.repository';
import { budgetCommitConstraint, budgetGrantOperationConstraint } from './budget-commit-fence';
import type { KnowledgeDoc } from './knowledge.repository';
import type { VerifiedTenantScope } from '../types/tenant';

export type KnowledgeListSnapshot = Readonly<{ documentRows:number; projectionBytes:number; revision:number; counterExists:boolean }>;
export type KnowledgeContentSnapshot = Readonly<{
  exists:boolean; filePath?:string; sourceBytes:number; versioned:boolean;
}>;
export type KnowledgeReadSnapshot = KnowledgeListSnapshot | KnowledgeContentSnapshot | undefined;
export type KnowledgeReadFence = Readonly<{
  credential:SessionBudgetCredential; authority:BudgetCommitAuthority; snapshot:KnowledgeReadSnapshot;
}>;

export class KnowledgeReadFenceError extends Error {
  constructor(readonly code:'unavailable'|'authority_changed') {
    super(code === 'authority_changed' ? 'Knowledge read authority changed' : 'Knowledge read accounting is unavailable');
    this.name='KnowledgeReadFenceError';
  }
}

function safeCount(value:unknown): value is number {
  return typeof value==='number' && Number.isSafeInteger(value) && value>=0;
}

/** Admission metadata only; these indexed reads never materialize a document list or R2 body. */
export class KnowledgeReadAccountingRepository {
  constructor(private readonly db:D1Database,private readonly scope:VerifiedTenantScope) {}

  async isGrantClosed(reservationId:string,holderId:string):Promise<boolean> {
    return Boolean(await this.db.prepare(`SELECT 1 FROM budget_grant_closures
      WHERE tenant_id=? AND reservation_id=? AND holder_id=? LIMIT 1`)
      .bind(this.scope.tenantId,reservationId,holderId).first());
  }

  async listSnapshot():Promise<KnowledgeListSnapshot> {
    const row=await this.db.prepare(`SELECT document_rows,projection_bytes,revision FROM knowledge_read_scan_counters
      WHERE tenant_id=? LIMIT 1`).bind(this.scope.tenantId).first<{document_rows:number;projection_bytes:number;revision:number}>();
    if(!row){
      // A tenant created after migration has no counter until its first
      // document. The primary-key probe is bounded and distinguishes that
      // valid empty state from missing accounting for retained history.
      const document=await this.db.prepare(`SELECT 1 FROM knowledge_docs WHERE tenant_id=? LIMIT 1`)
        .bind(this.scope.tenantId).first();
      if(document)throw new KnowledgeReadFenceError('unavailable');
      return {documentRows:0,projectionBytes:0,revision:0,counterExists:false};
    }
    if(!safeCount(row.document_rows)||!safeCount(row.projection_bytes)||!safeCount(row.revision))throw new KnowledgeReadFenceError('unavailable');
    return {documentRows:row.document_rows,projectionBytes:row.projection_bytes,revision:row.revision,counterExists:true};
  }

  async contentSnapshot(documentId:string):Promise<KnowledgeContentSnapshot> {
    const row=await this.db.prepare(`SELECT d.file_path,v.source_bytes FROM knowledge_docs d
      LEFT JOIN knowledge_index_versions v ON v.tenant_id=d.tenant_id AND v.document_id=d.id AND v.file_path=d.file_path
      WHERE d.tenant_id=? AND d.id=? LIMIT 1`).bind(this.scope.tenantId,documentId)
      .first<{file_path:string;source_bytes:number|null}>();
    if(!row)return {exists:false,sourceBytes:0,versioned:false};
    if(typeof row.file_path!=='string'||row.file_path.length===0)throw new KnowledgeReadFenceError('unavailable');
    const versioned=row.source_bytes!==null;
    if(versioned&&!safeCount(row.source_bytes))throw new KnowledgeReadFenceError('unavailable');
    return {exists:true,filePath:row.file_path,sourceBytes:versioned?row.source_bytes!:KNOWLEDGE_SOURCE_MAX_BYTES,versioned};
  }
}

function exactGrantConstraint(scope:VerifiedTenantScope,authority:BudgetCommitAuthority):{sql:string;values:unknown[]} {
  const grant=authority.grant;
  const valid=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value);
  if(!grant||!valid(grant.tenantId)||!valid(grant.reservationId)||!valid(grant.holderId)||!valid(grant.operationId)
    ||!valid(grant.aggregateId)||!valid(grant.operationFingerprint))return {sql:'0',values:[]};
  return {sql:`?=? AND ?=? AND ?=? AND NOT EXISTS (SELECT 1 FROM budget_grant_closures
      WHERE tenant_id=? AND reservation_id=? AND holder_id=?)`,values:[grant.operationId,authority.operationId,
    grant.operationFingerprint,authority.operationFingerprint,grant.tenantId,scope.tenantId,
    scope.tenantId,grant.reservationId,grant.holderId]};
}

function currentFenceSql(scope:VerifiedTenantScope,fence:KnowledgeReadFence):{sql:string;values:unknown[]} {
  const credential=fence.credential,budget=budgetCommitConstraint(fence.authority,scope.tenantId),exact=exactGrantConstraint(scope,fence.authority);
  const trusted=credential.tenantId===scope.tenantId&&credential.actorId===scope.actorId&&scope.roles.includes(credential.role)
    &&credential.sessionVersion===scope.authVersion&&credential.mfaVerified===true;
  return {sql:`?=1 AND EXISTS (SELECT 1 FROM users WHERE tenant_id=? AND id=? AND role=? AND session_version=?
      AND mfa_enabled=1 AND ?>unixepoch()) AND ${budget.sql} AND ${exact.sql}`,
    values:[trusted?1:0,scope.tenantId,scope.actorId,credential.role,credential.sessionVersion,credential.expiresAt,...budget.values,...exact.values]};
}

function exactOperationInsert(db:D1Database,scope:VerifiedTenantScope,authority:BudgetCommitAuthority,
  guard:{sql:string;values:unknown[]}):D1PreparedStatement {
  const grant=authority.grant;
  return db.prepare(`INSERT INTO budget_grant_operations
    (tenant_id,reservation_id,holder_id,operation_id,aggregate_id,operation_fingerprint,operation_envelope_json)
    SELECT ?,?,?,?,?,?,? WHERE ${guard.sql}
    ON CONFLICT(tenant_id,reservation_id,holder_id,operation_id) DO UPDATE SET operation_id=excluded.operation_id
      WHERE aggregate_id=excluded.aggregate_id AND operation_fingerprint=excluded.operation_fingerprint
        AND operation_envelope_json=excluded.operation_envelope_json`)
    .bind(scope.tenantId,grant?.reservationId??'',grant?.holderId??'',grant?.operationId??'',grant?.aggregateId??'',
      grant?.operationFingerprint??'',JSON.stringify(grant?.operationEnvelope??{}),...guard.values);
}

/** Every business read shares one native D1 snapshot with current credential,
 * policy, exact spent operation and dynamic accounting assertions. */
export class KnowledgeReadRepository {
  constructor(private readonly db:D1Database,private readonly scope:VerifiedTenantScope) {}

  private async read<T>(fence:KnowledgeReadFence,business:{sql:string;values:unknown[];orderBy?:string},extra?:{sql:string;values:unknown[]}):Promise<D1Result<T>> {
    const current=currentFenceSql(this.scope,fence);
    const guard=`${current.sql}${extra?` AND ${extra.sql}`:''}`,guardValues=[...current.values,...(extra?.values??[])];
    const guarded={sql:guard,values:guardValues},operation=budgetGrantOperationConstraint(this.scope,fence.authority);
    const insert=exactOperationInsert(this.db,this.scope,fence.authority,guarded);
    const assertion=this.db.prepare(`SELECT 1 AS admitted /* knowledge-read-fence */ WHERE ${guard} AND ${operation.sql} LIMIT 1`)
      .bind(...guardValues,...operation.values);
    // The business statement repeats the compact guard. A failed assertion
    // therefore cannot make D1 materialize an unadmitted document result.
    const statement=this.db.prepare(`${business.sql} AND (${guard}) AND (${operation.sql})${business.orderBy?` ORDER BY ${business.orderBy}`:''}`)
      .bind(...business.values,...guardValues,...operation.values);
    const results=await this.db.batch<T>([insert,assertion,statement]);
    if(!results[1]?.results?.[0])throw new KnowledgeReadFenceError('authority_changed');
    return results[2];
  }

  async list(fence:KnowledgeReadFence):Promise<KnowledgeDoc[]> {
    const snapshot=fence.snapshot as KnowledgeListSnapshot|undefined;
    if(!snapshot||!safeCount(snapshot.documentRows)||!safeCount(snapshot.projectionBytes)||!safeCount(snapshot.revision)
      ||typeof snapshot.counterExists!=='boolean')throw new KnowledgeReadFenceError('unavailable');
    const counter=snapshot.counterExists
      ? {sql:`EXISTS (SELECT 1 FROM knowledge_read_scan_counters WHERE tenant_id=?
          AND document_rows<=? AND projection_bytes<=? AND revision>=0)`,values:[this.scope.tenantId,snapshot.documentRows,snapshot.projectionBytes]}
      : {sql:`NOT EXISTS (SELECT 1 FROM knowledge_read_scan_counters WHERE tenant_id=?)
          AND NOT EXISTS (SELECT 1 FROM knowledge_docs WHERE tenant_id=? LIMIT 1)`,values:[this.scope.tenantId,this.scope.tenantId]};
    const result=await this.read<KnowledgeDoc>(fence,{sql:`SELECT * FROM knowledge_docs WHERE tenant_id=?`,values:[this.scope.tenantId],orderBy:'created_at DESC'},counter);
    return result.results;
  }

  async detail(documentId:string,fence:KnowledgeReadFence):Promise<KnowledgeDoc|null> {
    const result=await this.read<KnowledgeDoc>(fence,{sql:`SELECT * FROM knowledge_docs WHERE tenant_id=? AND id=?`,values:[this.scope.tenantId,documentId]});
    return result.results[0]??null;
  }

  async contentSource(documentId:string,fence:KnowledgeReadFence):Promise<{filePath:string;sourceBytes:number;versioned:boolean}|null> {
    const snapshot=fence.snapshot as KnowledgeContentSnapshot|undefined;
    if(!snapshot)throw new KnowledgeReadFenceError('unavailable');
    const source=snapshot.exists
      ? {sql:`EXISTS (SELECT 1 FROM knowledge_docs d WHERE d.tenant_id=? AND d.id=? AND d.file_path=? AND ${snapshot.versioned
        ? `EXISTS (SELECT 1 FROM knowledge_index_versions v WHERE v.tenant_id=d.tenant_id AND v.document_id=d.id AND v.file_path=d.file_path AND v.source_bytes=?)`
        : `NOT EXISTS (SELECT 1 FROM knowledge_index_versions v WHERE v.tenant_id=d.tenant_id AND v.document_id=d.id AND v.file_path=d.file_path)`})`,
        values:[this.scope.tenantId,documentId,snapshot.filePath!,...(snapshot.versioned?[snapshot.sourceBytes]:[])]}
      : {sql:`NOT EXISTS (SELECT 1 FROM knowledge_docs WHERE tenant_id=? AND id=?)`,values:[this.scope.tenantId,documentId]};
    const result=await this.read<{file_path:string}>(fence,{sql:`SELECT file_path FROM knowledge_docs WHERE tenant_id=? AND id=?`,values:[this.scope.tenantId,documentId]},source);
    return result.results[0]?{filePath:result.results[0].file_path,sourceBytes:snapshot.sourceBytes,versioned:snapshot.versioned}:null;
  }
}
