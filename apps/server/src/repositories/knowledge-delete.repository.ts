import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { KnowledgeDeleteFence } from '../budgets/knowledge-delete-admission.service';
import type { Env } from '../bindings';
import { staffMutationStatements } from './staff-ticket-mutation.repository';
import { budgetCommitConstraint, budgetGrantOperationConstraint, budgetGrantOperationStatements } from './budget-commit-fence';

const DELETE_VECTOR_BATCH=100;
type Identity=Readonly<{revision:number;reservation:string;holder:string;operation:string;fingerprint:string;aggregate:string}>;
export type KnowledgeDeleteWork=Readonly<{itemKey:string;itemKind:'r2_source'|'vector_batch'|'finalize';payload:string;attemptToken:number}>;

function identity(authority:BudgetCommitAuthority):Identity|null{
  const grant=authority.grant;
  if(!grant||grant.tenantId!==authority.snapshot.tenant_id||grant.operationId!==authority.operationId
    ||grant.operationFingerprint!==authority.operationFingerprint)return null;
  return {revision:authority.snapshot.authority_revision,reservation:grant.reservationId,holder:grant.holderId,
    operation:grant.operationId,fingerprint:grant.operationFingerprint,aggregate:grant.aggregateId};
}

/** The active job retains paths and vector ids only until cleanup. Finalization
 * uses an opaque marker only inside the atomic proof-and-job-removal batch. */
export class KnowledgeDeleteRepository{
  constructor(private readonly db:D1Database,private readonly scope:VerifiedTenantScope){}

  private admitted(authority:BudgetCommitAuthority){
    const budget=budgetCommitConstraint(authority,this.scope.tenantId,['new-work','recovery']);
    const exact=budgetGrantOperationConstraint(this.scope,authority);
    return {sql:`(${budget.sql}) AND (${exact.sql})`,values:[...budget.values,...exact.values]};
  }

  async revoke(documentId:string,fence?:KnowledgeDeleteFence):Promise<string|null>{
    const proposed=crypto.randomUUID();
    const prefix:readonly D1PreparedStatement[]=fence
      ?[...staffMutationStatements(this.db,this.scope,fence),...budgetGrantOperationStatements(this.db,this.scope,fence.authority)]
      :[this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) VALUES (?,1)
          ON CONFLICT(tenant_id) DO UPDATE SET accepted=1`).bind(this.scope.tenantId)];
    const accepted=`EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`;
    const result=await this.db.batch([
      ...prefix,
      this.db.prepare(`INSERT OR IGNORE INTO knowledge_delete_jobs
        (tenant_id,document_id,source_kind,delete_token,legacy_file_path,legacy_vector_count,max_version,state)
        SELECT d.tenant_id,d.id,'document',?,
          CASE WHEN EXISTS (SELECT 1 FROM knowledge_index_versions v WHERE v.tenant_id=d.tenant_id AND v.document_id=d.id
            AND v.source_kind='document' AND v.file_path=d.file_path) THEN NULL ELSE d.file_path END,
          CASE WHEN EXISTS (SELECT 1 FROM knowledge_index_versions v WHERE v.tenant_id=d.tenant_id AND v.document_id=d.id
            AND v.source_kind='document') THEN 0 WHEN d.chunk_count>0 THEN d.chunk_count WHEN d.status='published' THEN NULL ELSE 0 END,
          COALESCE((SELECT MAX(v.version) FROM knowledge_index_versions v WHERE v.tenant_id=d.tenant_id AND v.document_id=d.id
            AND v.source_kind='document'),0),
          'active'
        FROM knowledge_docs d WHERE d.tenant_id=? AND d.id=? AND ${accepted}
          AND NOT EXISTS (SELECT 1 FROM knowledge_delete_tombstones t WHERE t.tenant_id=d.tenant_id AND t.document_id=d.id AND t.source_kind='document')`)
        .bind(proposed,this.scope.tenantId,documentId,this.scope.tenantId),
      this.db.prepare(`UPDATE knowledge_index_versions SET state='withdrawn' WHERE tenant_id=? AND document_id=? AND source_kind='document'
        AND version=(SELECT max_version FROM knowledge_delete_jobs WHERE tenant_id=? AND document_id=? AND source_kind='document')
        AND state NOT IN ('withdrawn','failed') AND ${accepted}`)
        .bind(this.scope.tenantId,documentId,this.scope.tenantId,documentId,this.scope.tenantId),
      this.db.prepare(`DELETE FROM knowledge_docs WHERE tenant_id=? AND id=? AND ${accepted}
        AND EXISTS (SELECT 1 FROM knowledge_delete_jobs j WHERE j.tenant_id=? AND j.document_id=? AND j.source_kind='document')`)
        .bind(this.scope.tenantId,documentId,this.scope.tenantId,this.scope.tenantId,documentId),
      this.db.prepare(`SELECT delete_token FROM knowledge_delete_jobs WHERE tenant_id=? AND document_id=? AND source_kind='document' AND ${accepted} LIMIT 1`)
        .bind(this.scope.tenantId,documentId,this.scope.tenantId),
    ]);
    const row=result[result.length-1]?.results?.[0] as {delete_token?:string}|undefined;
    return row?.delete_token??null;
  }

  async startStep(authority:BudgetCommitAuthority):Promise<void>{
    const budget=budgetCommitConstraint(authority,this.scope.tenantId,['new-work','recovery']);
    const valid=this.scope.roles.includes('system')&&this.scope.actorId==='knowledge-delete';
    const result=await this.db.batch([
      this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) VALUES (?,CASE WHEN ?=1 AND ${budget.sql} THEN 1 ELSE 0 END)
        ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId,valid?1:0,...budget.values),
      ...budgetGrantOperationStatements(this.db,this.scope,authority),
      this.db.prepare(`SELECT accepted FROM budget_mutation_assertion WHERE tenant_id=?`).bind(this.scope.tenantId),
    ]);
    if(!(result[result.length-1]?.results?.[0] as {accepted?:number}|undefined)?.accepted)throw new Error('Knowledge delete step authority unavailable');
  }

  private async job(documentId:string,token:string,authority:BudgetCommitAuthority){
    const guard=this.admitted(authority);
    return this.db.prepare(`SELECT legacy_file_path AS legacyPath,legacy_vector_count AS legacyCount,max_version AS maxVersion,
      legacy_source_done AS legacySourceDone,source_cursor AS sourceCursor,sources_done AS sourcesDone,
      vector_version_cursor AS vectorVersion,vector_chunk_cursor AS vectorChunk,legacy_vector_cursor AS legacyVector,
      vectors_done AS vectorsDone,state FROM knowledge_delete_jobs WHERE tenant_id=? AND document_id=? AND source_kind='document'
      AND delete_token=? AND state IN ('active','legacy_manifest_required','finalizing') AND ${guard.sql} LIMIT 1`)
      .bind(this.scope.tenantId,documentId,token,...guard.values).first<{legacyPath:string|null;legacyCount:number|null;maxVersion:number;
        legacySourceDone:number;sourceCursor:number;sourcesDone:number;vectorVersion:number;vectorChunk:number;legacyVector:number;
        vectorsDone:number;state:string}>();
  }

  private async materialize(documentId:string,token:string,authority:BudgetCommitAuthority):Promise<'made'|'advanced'|'blocked'|'complete'>{
    const j=await this.job(documentId,token,authority);if(!j)return 'complete';
    const guard=this.admitted(authority),a=`${guard.sql}`;
    if(j.state==='legacy_manifest_required')return 'blocked';
    if(!j.sourcesDone){
      const active=await this.db.prepare(`SELECT 1 FROM knowledge_index_jobs x JOIN knowledge_index_versions v
        ON v.tenant_id=x.tenant_id AND v.document_id=x.document_id AND v.version=x.version
        WHERE x.tenant_id=? AND x.document_id=? AND v.source_kind='document' AND v.version<=?
          AND x.state='source_pending' AND x.provider_lease_expires_at>CURRENT_TIMESTAMP AND ${a} LIMIT 1`)
        .bind(this.scope.tenantId,documentId,j.maxVersion,...guard.values).first();
      if(active)return 'blocked';
      if(!j.legacySourceDone){
        const statements:D1PreparedStatement[]=[];
        if(j.legacyPath)statements.push(this.db.prepare(`INSERT OR IGNORE INTO knowledge_delete_work
          (tenant_id,document_id,source_kind,delete_token,item_key,item_kind,payload_json,state)
          SELECT ?,?,'document',?,'r2:legacy','r2_source',json_object('path',?),'pending' WHERE ${a}`)
          .bind(this.scope.tenantId,documentId,token,j.legacyPath,...guard.values));
        statements.push(this.db.prepare(`UPDATE knowledge_delete_jobs SET legacy_source_done=1,updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=? AND ${a}`)
          .bind(this.scope.tenantId,documentId,token,...guard.values));
        await this.db.batch(statements);return j.legacyPath?'made':'advanced';
      }
      const version=await this.db.prepare(`SELECT version,file_path AS path FROM knowledge_index_versions WHERE tenant_id=? AND document_id=?
        AND source_kind='document' AND version>? AND version<=? AND ${a} ORDER BY version LIMIT 1`)
        .bind(this.scope.tenantId,documentId,j.sourceCursor,j.maxVersion,...guard.values).first<{version:number;path:string}>();
      if(version){await this.db.batch([
        this.db.prepare(`INSERT OR IGNORE INTO knowledge_delete_work
          (tenant_id,document_id,source_kind,delete_token,item_key,item_kind,payload_json,state)
          SELECT ?,?,'document',?,?, 'r2_source',json_object('path',?),'pending' WHERE ${a}`)
          .bind(this.scope.tenantId,documentId,token,`r2:version:${version.version}`,version.path,...guard.values),
        this.db.prepare(`UPDATE knowledge_delete_jobs SET source_cursor=?,updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=? AND source_cursor<? AND ${a}`)
          .bind(version.version,this.scope.tenantId,documentId,token,version.version,...guard.values),
      ]);return 'made';}
      await this.db.prepare(`UPDATE knowledge_delete_jobs SET sources_done=1,updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=? AND ${a}`)
        .bind(this.scope.tenantId,documentId,token,...guard.values).run();return 'advanced';
    }
    if(!j.vectorsDone){
      const live=await this.db.prepare(`SELECT 1 FROM knowledge_index_chunks c JOIN knowledge_index_versions v
        ON v.tenant_id=c.tenant_id AND v.document_id=c.document_id AND v.version=c.version
        WHERE c.tenant_id=? AND c.document_id=? AND v.source_kind='document' AND v.version<=?
          AND c.state='claimed' AND c.provider_lease_expires_at>CURRENT_TIMESTAMP AND ${a} LIMIT 1`)
        .bind(this.scope.tenantId,documentId,j.maxVersion,...guard.values).first();
      if(live)return 'blocked';
      const chunks=(await this.db.prepare(`SELECT c.version,c.chunk_index AS chunkIndex,c.vector_id AS vectorId
        FROM knowledge_index_chunks c JOIN knowledge_index_versions v ON v.tenant_id=c.tenant_id AND v.document_id=c.document_id AND v.version=c.version
        WHERE c.tenant_id=? AND c.document_id=? AND v.source_kind='document' AND v.version<=?
          AND (c.version>? OR (c.version=? AND c.chunk_index>?)) AND ${a}
        ORDER BY c.version,c.chunk_index LIMIT ?`).bind(this.scope.tenantId,documentId,j.maxVersion,j.vectorVersion,j.vectorVersion,
          j.vectorChunk,...guard.values,DELETE_VECTOR_BATCH).all<{version:number;chunkIndex:number;vectorId:string}>()).results;
      if(chunks.length){const last=chunks[chunks.length-1];await this.db.batch([
        this.db.prepare(`INSERT OR IGNORE INTO knowledge_delete_work
          (tenant_id,document_id,source_kind,delete_token,item_key,item_kind,payload_json,state)
          SELECT ?,?,'document',?,?,'vector_batch',?,'pending' WHERE ${a}`)
          .bind(this.scope.tenantId,documentId,token,`vector:${chunks[0].version}:${chunks[0].chunkIndex}-${last.version}:${last.chunkIndex}`,
            JSON.stringify({ids:chunks.map(row=>row.vectorId)}),...guard.values),
        this.db.prepare(`UPDATE knowledge_delete_jobs SET vector_version_cursor=?,vector_chunk_cursor=?,updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=? AND ${a}`)
          .bind(last.version,last.chunkIndex,this.scope.tenantId,documentId,token,...guard.values),
      ]);return 'made';}
      if(j.legacyCount===null){await this.db.prepare(`UPDATE knowledge_delete_jobs SET state='legacy_manifest_required',updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=? AND ${a}`)
        .bind(this.scope.tenantId,documentId,token,...guard.values).run();return 'blocked';}
      if(j.legacyVector<j.legacyCount){const end=Math.min(j.legacyVector+DELETE_VECTOR_BATCH,j.legacyCount);
        const ids=Array.from({length:end-j.legacyVector},(_,offset)=>`doc_${documentId}_${j.legacyVector+offset}`);
        await this.db.batch([
          this.db.prepare(`INSERT OR IGNORE INTO knowledge_delete_work
            (tenant_id,document_id,source_kind,delete_token,item_key,item_kind,payload_json,state)
            SELECT ?,?,'document',?,?,'vector_batch',?,'pending' WHERE ${a}`)
            .bind(this.scope.tenantId,documentId,token,`vector:legacy:${j.legacyVector}-${end}`,JSON.stringify({ids}),...guard.values),
          this.db.prepare(`UPDATE knowledge_delete_jobs SET legacy_vector_cursor=?,updated_at=CURRENT_TIMESTAMP
            WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=? AND ${a}`)
            .bind(end,this.scope.tenantId,documentId,token,...guard.values),
        ]);return 'made';}
      await this.db.prepare(`UPDATE knowledge_delete_jobs SET vectors_done=1,state='finalizing',updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=? AND ${a}`)
        .bind(this.scope.tenantId,documentId,token,...guard.values).run();return 'advanced';
    }
    await this.db.prepare(`INSERT OR IGNORE INTO knowledge_delete_work
      (tenant_id,document_id,source_kind,delete_token,item_key,item_kind,payload_json,state)
      SELECT ?,?,'document',?,'z:finalize','finalize','{}','pending' WHERE ${a}`)
      .bind(this.scope.tenantId,documentId,token,...guard.values).run();return 'made';
  }

  async claimNext(documentId:string,token:string,authority:BudgetCommitAuthority):Promise<KnowledgeDeleteWork|null>{
    await this.startStep(authority);
    const guard=this.admitted(authority),id=identity(authority);if(!id)throw new Error('Knowledge delete grant identity unavailable');
    await this.db.prepare(`UPDATE knowledge_delete_work SET state='uncertain',lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=? AND state='claimed'
        AND lease_expires_at<=CURRENT_TIMESTAMP AND ${guard.sql}`).bind(this.scope.tenantId,documentId,token,...guard.values).run();
    for(let pass=0;pass<6;pass++){
      const row=await this.db.prepare(`SELECT item_key AS itemKey,item_kind AS itemKind,payload_json AS payload,attempt_token AS attemptToken
        FROM knowledge_delete_work WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=?
          AND state IN ('pending','uncertain') AND ${guard.sql} ORDER BY item_key LIMIT 1`)
        .bind(this.scope.tenantId,documentId,token,...guard.values).first<KnowledgeDeleteWork>();
      if(row){const claimed=await this.db.prepare(`UPDATE knowledge_delete_work SET state='claimed',attempts=attempts+1,attempt_token=attempt_token+1,
          authority_revision=?,recovery_reservation=?,authority_holder_id=?,authority_operation_id=?,authority_operation_fingerprint=?,
          authority_aggregate_id=?,lease_expires_at=datetime('now','+5 minutes'),updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=? AND item_key=?
            AND state IN ('pending','uncertain') AND attempts<1000000 AND ${guard.sql}`)
          .bind(id.revision,id.reservation,id.holder,id.operation,id.fingerprint,id.aggregate,this.scope.tenantId,documentId,token,row.itemKey,...guard.values).run();
        return claimed.meta.changes===1?{...row,attemptToken:row.attemptToken+1}:null;}
      const outcome=await this.materialize(documentId,token,authority);if(outcome==='blocked'||outcome==='complete')return null;
    }
    return null;
  }

  async authorizeEffect(documentId:string,token:string,work:KnowledgeDeleteWork,authority:BudgetCommitAuthority):Promise<boolean>{
    const guard=this.admitted(authority),id=identity(authority);if(!id)return false;
    return !!await this.db.prepare(`SELECT 1 FROM knowledge_delete_work WHERE tenant_id=? AND document_id=? AND source_kind='document'
      AND delete_token=? AND item_key=? AND item_kind=? AND attempt_token=? AND state='claimed' AND lease_expires_at>CURRENT_TIMESTAMP
      AND authority_revision=? AND recovery_reservation=? AND authority_holder_id=? AND authority_operation_id=?
      AND authority_operation_fingerprint=? AND authority_aggregate_id=? AND ${guard.sql} LIMIT 1`)
      .bind(this.scope.tenantId,documentId,token,work.itemKey,work.itemKind,work.attemptToken,id.revision,id.reservation,id.holder,
        id.operation,id.fingerprint,id.aggregate,...guard.values).first();
  }

  async completeWork(documentId:string,token:string,work:KnowledgeDeleteWork,authority:BudgetCommitAuthority):Promise<boolean>{
    const guard=this.admitted(authority);
    const result=await this.db.prepare(`UPDATE knowledge_delete_work SET state='complete',lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=? AND item_key=? AND attempt_token=?
        AND state='claimed' AND ${guard.sql}`).bind(this.scope.tenantId,documentId,token,work.itemKey,work.attemptToken,...guard.values).run();
    return result.meta.changes===1;
  }
  async uncertain(documentId:string,token:string,work:KnowledgeDeleteWork):Promise<void>{
    await this.db.prepare(`UPDATE knowledge_delete_work SET state='uncertain',lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=? AND item_key=? AND attempt_token=? AND state='claimed'`)
      .bind(this.scope.tenantId,documentId,token,work.itemKey,work.attemptToken).run();
  }
  async continueWork(documentId:string,token:string,work:KnowledgeDeleteWork,authority:BudgetCommitAuthority):Promise<void>{
    const guard=this.admitted(authority);await this.db.prepare(`UPDATE knowledge_delete_work SET state='pending',lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=? AND item_key=? AND attempt_token=?
      AND state='claimed' AND ${guard.sql}`).bind(this.scope.tenantId,documentId,token,work.itemKey,work.attemptToken,...guard.values).run();
  }

  async finalizeOne(documentId:string,token:string,work:KnowledgeDeleteWork,authority:BudgetCommitAuthority):Promise<'more'|'complete'|'stale'>{
    if(work.itemKind!=='finalize')return 'stale';const guard=this.admitted(authority);
    if(!await this.authorizeEffect(documentId,token,work,authority))return 'stale';
    const chunks=await this.db.prepare(`DELETE FROM knowledge_index_chunks WHERE rowid IN (SELECT c.rowid FROM knowledge_index_chunks c
      JOIN knowledge_index_versions v ON v.tenant_id=c.tenant_id AND v.document_id=c.document_id AND v.version=c.version
      JOIN knowledge_delete_jobs j ON j.tenant_id=c.tenant_id AND j.document_id=c.document_id AND j.source_kind='document'
      WHERE c.tenant_id=? AND c.document_id=? AND v.source_kind='document' AND v.version<=j.max_version LIMIT ?)
      AND ${guard.sql}`).bind(this.scope.tenantId,documentId,DELETE_VECTOR_BATCH,...guard.values).run();
    if(chunks.meta.changes){await this.continueWork(documentId,token,work,authority);return 'more';}
    const indexJob=await this.db.prepare(`DELETE FROM knowledge_index_jobs WHERE rowid IN (SELECT x.rowid FROM knowledge_index_jobs x
      JOIN knowledge_index_versions v ON v.tenant_id=x.tenant_id AND v.document_id=x.document_id AND v.version=x.version
      JOIN knowledge_delete_jobs j ON j.tenant_id=x.tenant_id AND j.document_id=x.document_id AND j.source_kind='document'
      WHERE x.tenant_id=? AND x.document_id=? AND v.source_kind='document' AND v.version<=j.max_version LIMIT 1) AND ${guard.sql}`)
      .bind(this.scope.tenantId,documentId,...guard.values).run();
    if(indexJob.meta.changes){await this.continueWork(documentId,token,work,authority);return 'more';}
    const version=await this.db.prepare(`DELETE FROM knowledge_index_versions WHERE rowid IN (SELECT v.rowid FROM knowledge_index_versions v
      JOIN knowledge_delete_jobs j ON j.tenant_id=v.tenant_id AND j.document_id=v.document_id AND j.source_kind='document'
      WHERE v.tenant_id=? AND v.document_id=? AND v.source_kind='document' AND v.version<=j.max_version LIMIT 1) AND ${guard.sql}`)
      .bind(this.scope.tenantId,documentId,...guard.values).run();
    if(version.meta.changes){await this.continueWork(documentId,token,work,authority);return 'more';}
    const cleanup=await this.db.prepare(`DELETE FROM knowledge_index_cleanup_jobs WHERE tenant_id=? AND document_id=? AND source_kind='document'
      AND ${guard.sql}`).bind(this.scope.tenantId,documentId,...guard.values).run();
    if(cleanup.meta.changes){await this.continueWork(documentId,token,work,authority);return 'more';}
    const receipt=await this.db.prepare(`DELETE FROM knowledge_delete_work WHERE rowid IN (SELECT rowid FROM knowledge_delete_work
      WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=? AND state='complete' ORDER BY item_key LIMIT 1)
      AND ${guard.sql}`).bind(this.scope.tenantId,documentId,token,...guard.values).run();
    if(receipt.meta.changes){await this.continueWork(documentId,token,work,authority);return 'more';}
    const results=await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO knowledge_delete_tombstones(tenant_id,document_id,source_kind)
        SELECT ?,?,'document' WHERE ${guard.sql} AND NOT EXISTS (SELECT 1 FROM knowledge_delete_work
          WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=? AND item_key!='z:finalize')`)
        .bind(this.scope.tenantId,documentId,...guard.values,this.scope.tenantId,documentId,token),
      this.db.prepare(`DELETE FROM knowledge_delete_work WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=?
        AND item_key='z:finalize' AND attempt_token=? AND state='claimed' AND ${guard.sql}
        AND EXISTS (SELECT 1 FROM knowledge_delete_tombstones WHERE tenant_id=? AND document_id=? AND source_kind='document')`)
        .bind(this.scope.tenantId,documentId,token,work.attemptToken,...guard.values,this.scope.tenantId,documentId),
      this.db.prepare(`DELETE FROM knowledge_delete_jobs WHERE tenant_id=? AND document_id=? AND source_kind='document' AND delete_token=?
        AND ${guard.sql} AND NOT EXISTS (SELECT 1 FROM knowledge_delete_work WHERE tenant_id=? AND document_id=? AND source_kind='document')
        AND EXISTS (SELECT 1 FROM knowledge_delete_tombstones WHERE tenant_id=? AND document_id=? AND source_kind='document')`)
        .bind(this.scope.tenantId,documentId,token,...guard.values,this.scope.tenantId,documentId,this.scope.tenantId,documentId),
      this.db.prepare(`DELETE FROM knowledge_delete_tombstones WHERE tenant_id=? AND document_id=? AND source_kind='document'
        AND NOT EXISTS (SELECT 1 FROM knowledge_delete_jobs WHERE tenant_id=? AND document_id=? AND source_kind='document') AND ${guard.sql}`)
        .bind(this.scope.tenantId,documentId,this.scope.tenantId,documentId,...guard.values),
    ]);
    return results[2].meta.changes===1?'complete':'stale';
  }

  async nextContinuation(documentId:string,token:string):Promise<'new-work'|'recovery'|null>{
    const row=await this.db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM knowledge_delete_work w WHERE w.tenant_id=j.tenant_id
      AND w.document_id=j.document_id AND w.source_kind='document' AND w.delete_token=j.delete_token AND w.state='uncertain')
      THEN 'recovery' ELSE 'new-work' END AS purpose FROM knowledge_delete_jobs j
      WHERE j.tenant_id=? AND j.document_id=? AND j.source_kind='document' AND j.delete_token=? LIMIT 1`)
      .bind(this.scope.tenantId,documentId,token).first<{purpose:'new-work'|'recovery'}>();return row?.purpose??null;
  }

  static async pending(env:Pick<Env,'DB'>,limit=16):Promise<readonly {tenantId:string;documentId:string;token:string;purpose:'new-work'|'recovery'}[]>{
    return (await env.DB.prepare(`SELECT j.tenant_id AS tenantId,j.document_id AS documentId,j.delete_token AS token,
      CASE WHEN EXISTS (SELECT 1 FROM knowledge_delete_work w WHERE w.tenant_id=j.tenant_id AND w.document_id=j.document_id
        AND w.source_kind='document' AND w.delete_token=j.delete_token AND w.state IN ('uncertain','claimed') AND (w.lease_expires_at IS NULL OR w.lease_expires_at<=CURRENT_TIMESTAMP))
        THEN 'recovery' ELSE 'new-work' END AS purpose FROM knowledge_delete_jobs j
      WHERE j.state IN ('active','finalizing') ORDER BY j.updated_at,j.tenant_id,j.document_id LIMIT ?`).bind(limit)
      .all<{tenantId:string;documentId:string;token:string;purpose:'new-work'|'recovery'}>()).results;
  }
}
