import type {D1Database,D1PreparedStatement} from '@cloudflare/workers-types';
import type {VerifiedTenantScope} from '../types/tenant';
import type {SessionBudgetCredential,SessionBudgetRequirements} from './session-budget-authority.repository';
import type {BudgetCommitAuthority} from '../budgets/isolate-admission.service';
import {staffMutationStatements} from './staff-ticket-mutation.repository';

export type ChannelConfigurationOperation='dashboard.channel.email.list'|'dashboard.channel.email.create'|'dashboard.channel.email.delete';
export type ChannelConfigurationMutationOperation=Exclude<ChannelConfigurationOperation,'dashboard.channel.email.list'>;
export type ChannelConfigurationNamespace=Readonly<{principalId:string;operation:ChannelConfigurationMutationOperation;keyHash:string;payloadHash:string}>;
export type ChannelConfigurationCommit=Readonly<{credential:SessionBudgetCredential;requirements:SessionBudgetRequirements;
  authority:BudgetCommitAuthority;namespace?:ChannelConfigurationNamespace;businessD1RowsRead?:number;businessD1RowsWritten?:number}>;
export type ChannelPopulation=Readonly<{exists:boolean;rowCount:number;defaultRows:number;contentBytes:number;revision:number}>;
export type ChannelTarget=Readonly<{exists:boolean;contentBytes:number;revision:number}>;
export type ChannelSnapshot=Readonly<{population:ChannelPopulation;target?:ChannelTarget}>;
export type ChannelReceipt=Readonly<{payload_hash:string;response_status:200|201;response_bytes:number;
  reserved_d1_rows_read:number;reserved_d1_rows_written:number}>;
export type SupportEmailRow=Readonly<{tenant_id:string;id:string;email_address:string;normalized_email:string;name:string|null;
  is_default:number|boolean;group_id:string|null;created_at:string|null;updated_at:string|null}>;

const nsWhere='tenant_id=? AND principal_id=? AND operation=? AND key_hash=?';
const nsValues=(scope:VerifiedTenantScope,ns:ChannelConfigurationNamespace)=>[scope.tenantId,ns.principalId,ns.operation,ns.keyHash];
const safeCount=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const identity=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value);

function populationConstraint(scope:VerifiedTenantScope,population:ChannelPopulation):{sql:string;values:unknown[]}{
  return population.exists?{sql:`EXISTS (SELECT 1 FROM channel_configuration_population WHERE tenant_id=?
      AND row_count=? AND default_rows=? AND content_bytes=? AND revision=?)`,
    values:[scope.tenantId,population.rowCount,population.defaultRows,population.contentBytes,population.revision]}:
    {sql:`NOT EXISTS (SELECT 1 FROM channel_configuration_population WHERE tenant_id=?)
      AND NOT EXISTS (SELECT 1 FROM support_emails WHERE tenant_id=?)`,values:[scope.tenantId,scope.tenantId]};
}
function targetConstraint(scope:VerifiedTenantScope,id:string,target:ChannelTarget):{sql:string;values:unknown[]}{
  return target.exists?{sql:`EXISTS (SELECT 1 FROM support_email_admission_targets m JOIN support_emails e
      ON e.tenant_id=m.tenant_id AND e.id=m.email_id WHERE m.tenant_id=? AND m.email_id=?
      AND m.content_bytes=? AND m.revision=?)`,values:[scope.tenantId,id,target.contentBytes,target.revision]}:
    {sql:`NOT EXISTS (SELECT 1 FROM support_emails WHERE tenant_id=? AND id=?)
      AND NOT EXISTS (SELECT 1 FROM support_email_admission_targets WHERE tenant_id=? AND email_id=?)`,
    values:[scope.tenantId,id,scope.tenantId,id]};
}

/** Current credential/capability plus one exact, open grant at the channel D1 boundary. */
export function channelConfigurationFenceStatements(db:D1Database,scope:VerifiedTenantScope,commit:ChannelConfigurationCommit):D1PreparedStatement[]{
  const base=staffMutationStatements(db,scope,{credential:commit.credential,requirements:commit.requirements,authority:commit.authority})[0];
  const grant=commit.authority.grant,ns=commit.namespace;
  const namespaceLinked=!ns||(ns.principalId===commit.credential.actorId&&ns.keyHash===commit.authority.operationId
    &&ns.payloadHash===commit.authority.operationFingerprint);
  const linked=!!grant&&[grant.tenantId,grant.aggregateId,grant.reservationId,grant.holderId,grant.operationId,grant.operationFingerprint].every(identity)
    &&grant.tenantId===scope.tenantId&&grant.operationId===commit.authority.operationId
    &&grant.operationFingerprint===commit.authority.operationFingerprint&&namespaceLinked;
  const operation=db.prepare(`INSERT INTO budget_grant_operations
    (tenant_id,reservation_id,holder_id,operation_id,aggregate_id,operation_fingerprint,operation_envelope_json)
    SELECT ?,?,?,?,?,?,? WHERE ?=1 AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
      AND NOT EXISTS (SELECT 1 FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?)
    ON CONFLICT(tenant_id,reservation_id,holder_id,operation_id) DO UPDATE SET operation_id=excluded.operation_id
      WHERE aggregate_id=excluded.aggregate_id AND operation_fingerprint=excluded.operation_fingerprint
        AND operation_envelope_json=excluded.operation_envelope_json`).bind(scope.tenantId,grant?.reservationId??'',grant?.holderId??'',
      grant?.operationId??'',grant?.aggregateId??'',grant?.operationFingerprint??'',JSON.stringify(grant?.operationEnvelope??{}),linked?1:0,
      scope.tenantId,scope.tenantId,grant?.reservationId??'',grant?.holderId??'');
  const exact=db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1
    AND NOT EXISTS (SELECT 1 FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?)
    AND EXISTS (SELECT 1 FROM budget_grant_operations WHERE tenant_id=? AND reservation_id=? AND holder_id=?
      AND operation_id=? AND aggregate_id=? AND operation_fingerprint=? AND operation_envelope_json=?) THEN 1 ELSE 0 END
    WHERE tenant_id=?`).bind(scope.tenantId,grant?.reservationId??'',grant?.holderId??'',scope.tenantId,grant?.reservationId??'',
      grant?.holderId??'',grant?.operationId??'',grant?.aggregateId??'',grant?.operationFingerprint??'',
      JSON.stringify(grant?.operationEnvelope??{}),scope.tenantId);
  return[base,operation,exact];
}

export class ChannelConfigurationAdmissionRepository{
  constructor(private readonly db:D1Database,private readonly scope:VerifiedTenantScope){}
  async snapshot(targetId?:string):Promise<ChannelSnapshot>{
    const row=await this.db.prepare(`SELECT row_count,default_rows,content_bytes,revision FROM channel_configuration_population
      WHERE tenant_id=? LIMIT 1`).bind(this.scope.tenantId).first<{row_count:number;default_rows:number;content_bytes:number;revision:number}>();
    const population:ChannelPopulation=row?{exists:true,rowCount:row.row_count,defaultRows:row.default_rows,contentBytes:row.content_bytes,revision:row.revision}:
      {exists:false,rowCount:0,defaultRows:0,contentBytes:0,revision:0};
    if(![population.rowCount,population.defaultRows,population.contentBytes,population.revision].every(safeCount)||population.defaultRows>population.rowCount)
      throw new Error('Invalid channel population');
    if(targetId===undefined)return{population};
    const target=await this.db.prepare(`SELECT e.id,m.content_bytes,m.revision FROM support_emails e
      LEFT JOIN support_email_admission_targets m ON m.tenant_id=e.tenant_id AND m.email_id=e.id
      WHERE e.tenant_id=? AND e.id=? LIMIT 1`).bind(this.scope.tenantId,targetId)
      .first<{id:string;content_bytes:number|null;revision:number|null}>();
    if(!target){const stray=await this.db.prepare(`SELECT 1 AS present FROM support_email_admission_targets
        WHERE tenant_id=? AND email_id=? LIMIT 1`).bind(this.scope.tenantId,targetId).first();
      if(stray)throw new Error('Invalid channel target');return{population,target:{exists:false,contentBytes:0,revision:0}};}
    if(!safeCount(target.content_bytes)||!safeCount(target.revision))throw new Error('Invalid channel target');
    return{population,target:{exists:true,contentBytes:target.content_bytes,revision:target.revision}};
  }
  async groupExists(id:string):Promise<boolean>{return!!await this.db.prepare('SELECT 1 AS present FROM groups WHERE tenant_id=? AND id=? LIMIT 1').bind(this.scope.tenantId,id).first();}
  async findActive(ns:ChannelConfigurationNamespace):Promise<ChannelReceipt|null>{
    if(ns.principalId!==this.scope.actorId)return null;
    const receipt=await this.db.prepare(`SELECT payload_hash,response_status,response_bytes,reserved_d1_rows_read,reserved_d1_rows_written
      FROM channel_configuration_mutation_receipts WHERE ${nsWhere} AND expires_at>unixepoch()`)
      .bind(...nsValues(this.scope,ns)).first<ChannelReceipt>();
    if(receipt&&(!safeCount(receipt.response_bytes)||!safeCount(receipt.reserved_d1_rows_read)||receipt.reserved_d1_rows_read<4096
      ||!safeCount(receipt.reserved_d1_rows_written)||receipt.reserved_d1_rows_written<16))throw new Error('Invalid channel receipt');
    return receipt;
  }
  private fence(commit:ChannelConfigurationCommit,snapshot:ChannelSnapshot):D1PreparedStatement[]{
    const population=populationConstraint(this.scope,snapshot.population),statements=channelConfigurationFenceStatements(this.db,this.scope,commit);
    statements.push(this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1 AND (${population.sql})
      THEN 1 ELSE 0 END WHERE tenant_id=?`).bind(...population.values,this.scope.tenantId));return statements;
  }
  private targetFence(id:string,target:ChannelTarget):D1PreparedStatement{const constraint=targetConstraint(this.scope,id,target);
    return this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1 AND (${constraint.sql})
      THEN 1 ELSE 0 END WHERE tenant_id=?`).bind(...constraint.values,this.scope.tenantId);}
  private assertion(){return this.db.prepare('SELECT accepted FROM budget_mutation_assertion WHERE tenant_id=?').bind(this.scope.tenantId);}
  private cleanup(ns:ChannelConfigurationNamespace):D1PreparedStatement[]{return[
    this.db.prepare(`DELETE FROM channel_configuration_mutation_receipts WHERE ${nsWhere} AND expires_at<=unixepoch()
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`).bind(...nsValues(this.scope,ns),this.scope.tenantId),
    this.db.prepare(`DELETE FROM channel_configuration_mutation_receipts WHERE rowid IN (SELECT rowid FROM channel_configuration_mutation_receipts
      WHERE tenant_id=? AND principal_id=? AND expires_at<=unixepoch() ORDER BY expires_at LIMIT 16)
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`).bind(this.scope.tenantId,ns.principalId,this.scope.tenantId)];}

  async list(commit:ChannelConfigurationCommit,snapshot:ChannelSnapshot):Promise<SupportEmailRow[]>{
    const statements=this.fence(commit,snapshot);statements.push(this.db.prepare(`SELECT * FROM support_emails WHERE tenant_id=?
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1) ORDER BY created_at ASC`)
      .bind(this.scope.tenantId,this.scope.tenantId),this.assertion());
    const result=await this.db.batch<SupportEmailRow|{accepted:number}>(statements);
    if((result.at(-1)?.results[0] as any)?.accepted!==1)throw new Error('Channel list changed');
    return(result.at(-2)?.results as SupportEmailRow[]|undefined)??[];
  }
  async replay(commit:ChannelConfigurationCommit,ns:ChannelConfigurationNamespace,receipt:ChannelReceipt):Promise<string>{
    const statements=channelConfigurationFenceStatements(this.db,this.scope,commit);statements.push(this.db.prepare(`SELECT response_snapshot
      FROM channel_configuration_mutation_receipts WHERE ${nsWhere} AND payload_hash=? AND response_status=? AND response_bytes=?
      AND reserved_d1_rows_read=? AND reserved_d1_rows_written=? AND expires_at>unixepoch()
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1) LIMIT 1`)
      .bind(...nsValues(this.scope,ns),receipt.payload_hash,receipt.response_status,receipt.response_bytes,
        receipt.reserved_d1_rows_read,receipt.reserved_d1_rows_written,this.scope.tenantId),this.assertion());
    const result=await this.db.batch<{response_snapshot:string}|{accepted:number}>(statements);
    const response=(result.at(-2)?.results[0] as {response_snapshot?:string}|undefined)?.response_snapshot;
    if((result.at(-1)?.results[0] as any)?.accepted!==1||response===undefined)throw new Error('Channel replay was not admitted');return response;
  }
  async create(commit:ChannelConfigurationCommit,snapshot:ChannelSnapshot,row:Omit<SupportEmailRow,'created_at'|'updated_at'>):Promise<string>{
    if(!commit.namespace||commit.namespace.operation!=='dashboard.channel.email.create'||!safeCount(commit.businessD1RowsRead)
      ||!safeCount(commit.businessD1RowsWritten))throw new Error('Missing channel namespace');
    const statements=this.fence(commit,snapshot);
    statements.push(this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1 AND
      (? IS NULL OR EXISTS (SELECT 1 FROM groups WHERE tenant_id=? AND id=?)) THEN 1 ELSE 0 END WHERE tenant_id=?`)
      .bind(row.group_id,this.scope.tenantId,row.group_id,this.scope.tenantId),...this.cleanup(commit.namespace));
    if(row.is_default)statements.push(this.db.prepare(`UPDATE support_emails SET is_default=0 WHERE tenant_id=? AND is_default<>0
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`).bind(this.scope.tenantId,this.scope.tenantId));
    statements.push(this.db.prepare(`INSERT INTO support_emails(tenant_id,id,email_address,normalized_email,name,group_id,is_default)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`)
      .bind(row.tenant_id,row.id,row.email_address,row.normalized_email,row.name,row.group_id,row.is_default?1:0,this.scope.tenantId));
    statements.push(this.db.prepare(`INSERT INTO channel_configuration_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_bytes,reserved_d1_rows_read,reserved_d1_rows_written,response_snapshot)
      SELECT ?,?,?,?,?,201,length(CAST(body.snapshot AS BLOB)),?,?,body.snapshot FROM
      (SELECT json_object('tenant_id',e.tenant_id,'id',e.id,'email_address',e.email_address,'normalized_email',e.normalized_email,
        'name',e.name,'is_default',e.is_default,'group_id',e.group_id,'created_at',e.created_at,'updated_at',e.updated_at) snapshot
      FROM support_emails e WHERE e.tenant_id=? AND e.id=?) body
      WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1) RETURNING response_snapshot`)
      .bind(...nsValues(this.scope,commit.namespace),commit.namespace.payloadHash,commit.businessD1RowsRead,commit.businessD1RowsWritten,
        this.scope.tenantId,row.id,this.scope.tenantId));
    const result=await this.db.batch<{response_snapshot:string}>(statements),response=result.at(-1)?.results[0]?.response_snapshot;
    if(!response)throw new Error('Channel create changed');return response;
  }
  async delete(commit:ChannelConfigurationCommit,id:string,snapshot:ChannelSnapshot):Promise<string>{
    if(!commit.namespace||commit.namespace.operation!=='dashboard.channel.email.delete'||!snapshot.target
      ||!safeCount(commit.businessD1RowsRead)||!safeCount(commit.businessD1RowsWritten))throw new Error('Missing channel namespace');
    const statements=this.fence(commit,snapshot);statements.push(this.targetFence(id,snapshot.target),...this.cleanup(commit.namespace));
    statements.push(this.db.prepare(`DELETE FROM support_emails WHERE tenant_id=? AND id=?
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`).bind(this.scope.tenantId,id,this.scope.tenantId));
    statements.push(this.db.prepare(`INSERT INTO channel_configuration_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_bytes,reserved_d1_rows_read,reserved_d1_rows_written,response_snapshot)
      SELECT ?,?,?,?,?,200,length(CAST('{"success":true}' AS BLOB)),?,?,'{"success":true}'
      WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
        AND NOT EXISTS (SELECT 1 FROM support_emails WHERE tenant_id=? AND id=?) RETURNING response_snapshot`)
      .bind(...nsValues(this.scope,commit.namespace),commit.namespace.payloadHash,commit.businessD1RowsRead,commit.businessD1RowsWritten,
        this.scope.tenantId,this.scope.tenantId,id));
    const result=await this.db.batch<{response_snapshot:string}>(statements),response=result.at(-1)?.results[0]?.response_snapshot;
    if(!response)throw new Error('Channel delete changed');return response;
  }
}
