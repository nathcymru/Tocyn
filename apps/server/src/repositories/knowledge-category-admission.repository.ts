import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { SessionBudgetCredential, SessionBudgetRequirements } from './session-budget-authority.repository';
import type { VerifiedTenantScope } from '../types/tenant';
import { staffMutationStatements } from './staff-ticket-mutation.repository';

export type KnowledgeCategoryOperation='knowledge.category.list'|'knowledge.category.create'|'knowledge.category.delete';
export type KnowledgeCategoryMutationOperation=Exclude<KnowledgeCategoryOperation,'knowledge.category.list'>;
export type KnowledgeCategoryRow=Readonly<{tenant_id:string;id:string;name:string;parent_id:string|null;created_at:string}>;
export type KnowledgeCategoryPopulation=Readonly<{exists:boolean;categoryRows:number;projectionBytes:number;revision:number}>;
export type KnowledgeCategoryTarget=Readonly<{exists:boolean;name?:string;parentId?:string|null;createdAt?:string}>;
export type KnowledgeCategorySnapshot=Readonly<{population:KnowledgeCategoryPopulation;target?:KnowledgeCategoryTarget;documentRows?:number;documentRevision?:number}>;
export type KnowledgeCategoryNamespace=Readonly<{principalId:string;operation:KnowledgeCategoryMutationOperation;keyHash:string;payloadHash:string}>;
export type KnowledgeCategoryCommit=Readonly<{credential:SessionBudgetCredential;requirements:SessionBudgetRequirements;
  authority:BudgetCommitAuthority;namespace?:KnowledgeCategoryNamespace}>;
export type KnowledgeCategoryReceipt=Readonly<{payload_hash:string;response_status:200;response_snapshot:string}>;

const safe=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const identity=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value);
const nsWhere='tenant_id=? AND principal_id=? AND operation=? AND key_hash=?';
const nsValues=(scope:VerifiedTenantScope,ns:KnowledgeCategoryNamespace)=>[scope.tenantId,ns.principalId,ns.operation,ns.keyHash];

function populationConstraint(scope:VerifiedTenantScope,population:KnowledgeCategoryPopulation){
  return population.exists?{sql:`EXISTS (SELECT 1 FROM knowledge_category_population
    WHERE tenant_id=? AND category_rows=? AND projection_bytes=? AND revision=?)`,values:[scope.tenantId,population.categoryRows,population.projectionBytes,population.revision]}
    :{sql:`NOT EXISTS (SELECT 1 FROM knowledge_category_population WHERE tenant_id=?)
      AND NOT EXISTS (SELECT 1 FROM knowledge_categories WHERE tenant_id=?)`,values:[scope.tenantId,scope.tenantId]};
}

function targetConstraint(scope:VerifiedTenantScope,id:string,target:KnowledgeCategoryTarget){
  return target.exists?{sql:`EXISTS (SELECT 1 FROM knowledge_categories WHERE tenant_id=? AND id=? AND name=? AND parent_id IS ? AND created_at=?)`,
    values:[scope.tenantId,id,target.name!,target.parentId??null,target.createdAt!]}
    :{sql:`NOT EXISTS (SELECT 1 FROM knowledge_categories WHERE tenant_id=? AND id=?)`,values:[scope.tenantId,id]};
}

function exactFence(db:D1Database,scope:VerifiedTenantScope,commit:KnowledgeCategoryCommit):D1PreparedStatement[]{
  const base=staffMutationStatements(db,scope,{credential:commit.credential,requirements:commit.requirements,authority:commit.authority})[0];
  const grant=commit.authority.grant;
  const linked=!!grant&&[grant.tenantId,grant.aggregateId,grant.reservationId,grant.holderId,grant.operationId,grant.operationFingerprint].every(identity)
    &&grant.tenantId===scope.tenantId&&grant.operationId===commit.authority.operationId&&grant.operationFingerprint===commit.authority.operationFingerprint;
  const json=JSON.stringify(grant?.operationEnvelope??{});
  const operation=db.prepare(`INSERT INTO budget_grant_operations
    (tenant_id,reservation_id,holder_id,operation_id,aggregate_id,operation_fingerprint,operation_envelope_json)
    SELECT ?,?,?,?,?,?,? WHERE ?=1 AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
      AND NOT EXISTS (SELECT 1 FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?)
    ON CONFLICT(tenant_id,reservation_id,holder_id,operation_id) DO UPDATE SET operation_id=excluded.operation_id
      WHERE aggregate_id=excluded.aggregate_id AND operation_fingerprint=excluded.operation_fingerprint
        AND operation_envelope_json=excluded.operation_envelope_json`)
    .bind(scope.tenantId,grant?.reservationId??'',grant?.holderId??'',grant?.operationId??'',grant?.aggregateId??'',grant?.operationFingerprint??'',json,
      linked?1:0,scope.tenantId,scope.tenantId,grant?.reservationId??'',grant?.holderId??'');
  const exact=db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1
    AND NOT EXISTS (SELECT 1 FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?)
    AND EXISTS (SELECT 1 FROM budget_grant_operations WHERE tenant_id=? AND reservation_id=? AND holder_id=? AND operation_id=?
      AND aggregate_id=? AND operation_fingerprint=? AND operation_envelope_json=?) THEN 1 ELSE 0 END WHERE tenant_id=?`)
    .bind(scope.tenantId,grant?.reservationId??'',grant?.holderId??'',scope.tenantId,grant?.reservationId??'',grant?.holderId??'',
      grant?.operationId??'',grant?.aggregateId??'',grant?.operationFingerprint??'',json,scope.tenantId);
  return[base,operation,exact];
}

export class KnowledgeCategoryAdmissionRepository{
  constructor(private readonly db:D1Database,private readonly scope:VerifiedTenantScope){}

  async snapshot(targetId?:string,includeDocuments=false):Promise<KnowledgeCategorySnapshot>{
    const raw=await this.db.prepare(`SELECT category_rows,projection_bytes,revision FROM knowledge_category_population WHERE tenant_id=? LIMIT 1`)
      .bind(this.scope.tenantId).first<{category_rows:number;projection_bytes:number;revision:number}>();
    let population:KnowledgeCategoryPopulation;
    if(raw)population={exists:true,categoryRows:raw.category_rows,projectionBytes:raw.projection_bytes,revision:raw.revision};
    else{
      if(await this.db.prepare(`SELECT 1 FROM knowledge_categories WHERE tenant_id=? LIMIT 1`).bind(this.scope.tenantId).first())throw new Error('Missing category population');
      population={exists:false,categoryRows:0,projectionBytes:0,revision:0};
    }
    if(![population.categoryRows,population.projectionBytes,population.revision].every(safe))throw new Error('Invalid category population');
    let target:KnowledgeCategoryTarget|undefined;
    if(targetId!==undefined){
      const row=await this.db.prepare(`SELECT name,parent_id,created_at FROM knowledge_categories WHERE tenant_id=? AND id=? LIMIT 1`)
        .bind(this.scope.tenantId,targetId).first<{name:string;parent_id:string|null;created_at:string}>();
      target=row?{exists:true,name:row.name,parentId:row.parent_id,createdAt:row.created_at}:{exists:false};
    }
    if(!includeDocuments)return{population,...(target?{target}:{})};
    const docs=await this.db.prepare(`SELECT document_rows,revision FROM knowledge_read_scan_counters WHERE tenant_id=? LIMIT 1`)
      .bind(this.scope.tenantId).first<{document_rows:number;revision:number}>();
    if(!docs){
      if(await this.db.prepare(`SELECT 1 FROM knowledge_docs WHERE tenant_id=? LIMIT 1`).bind(this.scope.tenantId).first())throw new Error('Missing document population');
      return{population,...(target?{target}:{}),documentRows:0,documentRevision:0};
    }
    if(!safe(docs.document_rows)||!safe(docs.revision))throw new Error('Invalid document population');
    return{population,...(target?{target}:{}),documentRows:docs.document_rows,documentRevision:docs.revision};
  }

  async findActive(ns:KnowledgeCategoryNamespace):Promise<KnowledgeCategoryReceipt|null>{
    if(ns.principalId!==this.scope.actorId)return null;
    return this.db.prepare(`SELECT payload_hash,response_status,response_snapshot FROM knowledge_category_mutation_receipts
      WHERE ${nsWhere} AND expires_at>unixepoch()`).bind(...nsValues(this.scope,ns)).first<KnowledgeCategoryReceipt>();
  }

  private fence(commit:KnowledgeCategoryCommit,snapshot:KnowledgeCategorySnapshot):D1PreparedStatement[]{
    const population=populationConstraint(this.scope,snapshot.population),statements=exactFence(this.db,this.scope,commit);
    statements.push(this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1 AND (${population.sql}) THEN 1 ELSE 0 END WHERE tenant_id=?`)
      .bind(...population.values,this.scope.tenantId));
    return statements;
  }
  private cleanup(ns:KnowledgeCategoryNamespace):D1PreparedStatement[]{return[
    this.db.prepare(`DELETE FROM knowledge_category_mutation_receipts WHERE ${nsWhere} AND expires_at<=unixepoch()
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`).bind(...nsValues(this.scope,ns),this.scope.tenantId),
    this.db.prepare(`DELETE FROM knowledge_category_mutation_receipts WHERE rowid IN
      (SELECT rowid FROM knowledge_category_mutation_receipts WHERE tenant_id=? AND principal_id=? AND expires_at<=unixepoch() ORDER BY expires_at LIMIT 32)
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`).bind(this.scope.tenantId,ns.principalId,this.scope.tenantId)];}

  async list(commit:KnowledgeCategoryCommit,snapshot:KnowledgeCategorySnapshot):Promise<KnowledgeCategoryRow[]>{
    const statements=this.fence(commit,snapshot);
    statements.push(this.db.prepare(`SELECT * FROM knowledge_categories WHERE tenant_id=?
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1) ORDER BY created_at ASC`)
      .bind(this.scope.tenantId,this.scope.tenantId));
    statements.push(this.db.prepare(`SELECT accepted FROM budget_mutation_assertion WHERE tenant_id=?`).bind(this.scope.tenantId));
    const results=await this.db.batch<KnowledgeCategoryRow|{accepted:number}>(statements);
    if((results.at(-1)?.results[0] as {accepted?:number}|undefined)?.accepted!==1)throw new Error('Category list changed');
    return(results.at(-2)?.results as KnowledgeCategoryRow[]|undefined)??[];
  }

  async create(commit:KnowledgeCategoryCommit,snapshot:KnowledgeCategorySnapshot,row:KnowledgeCategoryRow,response:string):Promise<string>{
    if(!commit.namespace)throw new Error('Missing category namespace');
    const statements=this.fence(commit,snapshot);
    if(row.parent_id){
      if(!snapshot.target)throw new Error('Missing category parent snapshot');
      const parent=targetConstraint(this.scope,row.parent_id,snapshot.target);
      statements.push(this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1 AND (${parent.sql}) THEN 1 ELSE 0 END WHERE tenant_id=?`)
        .bind(...parent.values,this.scope.tenantId));
    }
    statements.push(...this.cleanup(commit.namespace));
    statements.push(this.db.prepare(`INSERT INTO knowledge_categories(tenant_id,id,name,parent_id,created_at)
      SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`)
      .bind(row.tenant_id,row.id,row.name,row.parent_id,row.created_at,this.scope.tenantId));
    statements.push(this.db.prepare(`INSERT INTO knowledge_category_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_snapshot)
      SELECT ?,?,?,?,?,200,? WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
        AND EXISTS (SELECT 1 FROM knowledge_categories WHERE tenant_id=? AND id=? AND name=? AND parent_id IS ?)
      RETURNING response_snapshot`).bind(...nsValues(this.scope,commit.namespace),commit.namespace.payloadHash,response,
        this.scope.tenantId,this.scope.tenantId,row.id,row.name,row.parent_id));
    const results=await this.db.batch<{response_snapshot:string}>(statements),value=results.at(-1)?.results[0]?.response_snapshot;
    if(!value)throw new Error('Category create changed');return value;
  }

  async delete(commit:KnowledgeCategoryCommit,id:string,snapshot:KnowledgeCategorySnapshot,response:string):Promise<string>{
    if(!commit.namespace||!snapshot.target||!safe(snapshot.documentRows)||!safe(snapshot.documentRevision))throw new Error('Missing category delete snapshot');
    const statements=this.fence(commit,snapshot),target=targetConstraint(this.scope,id,snapshot.target);
    statements.push(this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1 AND (${target.sql})
      AND COALESCE((SELECT document_rows=? AND revision=? FROM knowledge_read_scan_counters WHERE tenant_id=?),?=0) THEN 1 ELSE 0 END WHERE tenant_id=?`)
      .bind(...target.values,snapshot.documentRows,snapshot.documentRevision,this.scope.tenantId,snapshot.documentRows,this.scope.tenantId));
    statements.push(...this.cleanup(commit.namespace));
    statements.push(this.db.prepare(`SELECT
      EXISTS(SELECT 1 FROM knowledge_docs WHERE tenant_id=? AND category_id=? LIMIT 1) AS has_articles,
      EXISTS(SELECT 1 FROM knowledge_categories WHERE tenant_id=? AND parent_id=? LIMIT 1) AS has_children
      WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`)
      .bind(this.scope.tenantId,id,this.scope.tenantId,id,this.scope.tenantId));
    statements.push(this.db.prepare(`DELETE FROM knowledge_categories WHERE tenant_id=? AND id=?
      AND NOT EXISTS(SELECT 1 FROM knowledge_docs WHERE tenant_id=? AND category_id=? LIMIT 1)
      AND NOT EXISTS(SELECT 1 FROM knowledge_categories WHERE tenant_id=? AND parent_id=? LIMIT 1)
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`)
      .bind(this.scope.tenantId,id,this.scope.tenantId,id,this.scope.tenantId,id,this.scope.tenantId));
    statements.push(this.db.prepare(`INSERT INTO knowledge_category_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_snapshot)
      SELECT ?,?,?,?,?,200,? WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
        AND NOT EXISTS (SELECT 1 FROM knowledge_categories WHERE tenant_id=? AND id=?) RETURNING response_snapshot`)
      .bind(...nsValues(this.scope,commit.namespace),commit.namespace.payloadHash,response,this.scope.tenantId,this.scope.tenantId,id));
    const results=await this.db.batch<{response_snapshot?:string;has_articles?:number;has_children?:number}>(statements);
    const refs=results.at(-3)?.results[0];
    if(refs?.has_articles===1)throw new Error('Category contains articles and cannot be deleted');
    if(refs?.has_children===1)throw new Error('Category contains child categories and cannot be deleted');
    const value=results.at(-1)?.results[0]?.response_snapshot;if(!value)throw new Error('Category delete changed');return value;
  }
}
