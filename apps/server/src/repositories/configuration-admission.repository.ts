import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { SessionBudgetCredential, SessionBudgetRequirements } from './session-budget-authority.repository';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import { staffMutationStatements } from './staff-ticket-mutation.repository';

export type ConfigurationFamily = 'ticket-field' | 'automation';
export type ConfigurationOperation = 'dashboard.ticket-field.list' | 'dashboard.ticket-field.create' |
  'dashboard.automation.list' | 'dashboard.automation.create' | 'dashboard.automation.update' | 'dashboard.automation.delete';
export type ConfigurationMutationOperation = Extract<ConfigurationOperation, `${string}.create` | `${string}.update` | `${string}.delete`>;
export type ConfigurationNamespace = Readonly<{ principalId: string; operation: ConfigurationMutationOperation; keyHash: string; payloadHash: string }>;
export type ConfigurationCommit = Readonly<{ credential: SessionBudgetCredential; requirements: SessionBudgetRequirements;
  authority: BudgetCommitAuthority; namespace?: ConfigurationNamespace; businessD1RowsRead?: number }>;
export type ConfigurationPopulation = Readonly<{ exists: boolean; rowCount: number; contentBytes: number; revision: number }>;
export type AutomationTarget = Readonly<{ exists: boolean; contentBytes: number; revision: number }>;
export type ConfigurationSnapshot = Readonly<{ family: ConfigurationFamily; population: ConfigurationPopulation; target?: AutomationTarget }>;
export type ConfigurationReceipt = Readonly<{ payload_hash: string; response_status: 200 | 201; response_bytes: number; reserved_d1_rows_read: number }>;
export type TicketFieldRow = Readonly<{ tenant_id: string; id: string; name: string; label: string; field_type: string;
  options: string | null; is_active: number | boolean }>;
export type AutomationRow = Readonly<{ tenant_id: string; id: string; name: string; event_type: string;
  conditions: string | null; action_type: string; action_config: string | null; is_active: number | boolean; created_at: string | null }>;

const namespaceWhere = 'tenant_id=? AND principal_id=? AND operation=? AND key_hash=?';
const namespaceValues = (scope: VerifiedTenantScope, ns: ConfigurationNamespace) => [scope.tenantId,ns.principalId,ns.operation,ns.keyHash];
const safeCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);

function populationConstraint(scope: VerifiedTenantScope, snapshot: ConfigurationSnapshot): {sql:string;values:unknown[]} {
  return snapshot.population.exists ? {
    sql: `EXISTS (SELECT 1 FROM configuration_admission_population WHERE tenant_id=? AND family=?
      AND row_count=? AND content_bytes=? AND revision=?)`,
    values: [scope.tenantId,snapshot.family,snapshot.population.rowCount,snapshot.population.contentBytes,snapshot.population.revision],
  } : {
    sql: `NOT EXISTS (SELECT 1 FROM configuration_admission_population WHERE tenant_id=? AND family=?)
      AND NOT EXISTS (SELECT 1 FROM ${snapshot.family==='automation'?'automation_rules':'ticket_fields'} WHERE tenant_id=?)`,
    values: [scope.tenantId,snapshot.family,scope.tenantId],
  };
}

function targetConstraint(scope: VerifiedTenantScope, id: string, target: AutomationTarget): {sql:string;values:unknown[]} {
  return target.exists ? {
    sql: `EXISTS (SELECT 1 FROM automation_admission_targets m JOIN automation_rules a
      ON a.tenant_id=m.tenant_id AND a.id=m.automation_id WHERE m.tenant_id=? AND m.automation_id=?
      AND m.content_bytes=? AND m.revision=?)`,
    values: [scope.tenantId,id,target.contentBytes,target.revision],
  } : {
    sql: `NOT EXISTS (SELECT 1 FROM automation_rules WHERE tenant_id=? AND id=?)
      AND NOT EXISTS (SELECT 1 FROM automation_admission_targets WHERE tenant_id=? AND automation_id=?)`,
    values: [scope.tenantId,id,scope.tenantId,id],
  };
}

/** Establish current session/MFA/capability and one exact, still-open budget grant in the canonical batch. */
export function configurationFenceStatements(db: D1Database, scope: VerifiedTenantScope, commit: ConfigurationCommit): D1PreparedStatement[] {
  const base=staffMutationStatements(db,scope,{credential:commit.credential,requirements:commit.requirements,authority:commit.authority})[0];
  const grant=commit.authority.grant;
  const namespaceLinked=!commit.namespace||(commit.namespace.principalId===commit.credential.actorId
    && commit.namespace.keyHash===commit.authority.operationId&&commit.namespace.payloadHash===commit.authority.operationFingerprint);
  const linked=!!grant && [grant.tenantId,grant.aggregateId,grant.reservationId,grant.holderId,grant.operationId,grant.operationFingerprint].every(identity)
    && grant.tenantId===scope.tenantId && grant.operationId===commit.authority.operationId
    && grant.operationFingerprint===commit.authority.operationFingerprint&&namespaceLinked;
  const operation=db.prepare(`INSERT INTO budget_grant_operations
    (tenant_id,reservation_id,holder_id,operation_id,aggregate_id,operation_fingerprint,operation_envelope_json)
    SELECT ?,?,?,?,?,?,? WHERE ?=1
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
      AND NOT EXISTS (SELECT 1 FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?)
    ON CONFLICT(tenant_id,reservation_id,holder_id,operation_id) DO UPDATE SET operation_id=excluded.operation_id
      WHERE aggregate_id=excluded.aggregate_id AND operation_fingerprint=excluded.operation_fingerprint
        AND operation_envelope_json=excluded.operation_envelope_json`)
    .bind(scope.tenantId,grant?.reservationId??'',grant?.holderId??'',grant?.operationId??'',grant?.aggregateId??'',
      grant?.operationFingerprint??'',JSON.stringify(grant?.operationEnvelope??{}),linked?1:0,
      scope.tenantId,scope.tenantId,grant?.reservationId??'',grant?.holderId??'');
  const exact=db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1
    AND NOT EXISTS (SELECT 1 FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?)
    AND EXISTS (SELECT 1 FROM budget_grant_operations WHERE tenant_id=? AND reservation_id=? AND holder_id=?
      AND operation_id=? AND aggregate_id=? AND operation_fingerprint=? AND operation_envelope_json=?)
    THEN 1 ELSE 0 END WHERE tenant_id=?`)
    .bind(scope.tenantId,grant?.reservationId??'',grant?.holderId??'',scope.tenantId,grant?.reservationId??'',grant?.holderId??'',
      grant?.operationId??'',grant?.aggregateId??'',grant?.operationFingerprint??'',JSON.stringify(grant?.operationEnvelope??{}),scope.tenantId);
  return [base,operation,exact];
}

export class ConfigurationAdmissionRepository {
  constructor(private readonly db:D1Database,private readonly scope:VerifiedTenantScope) {}

  async snapshot(family:ConfigurationFamily,targetId?:string):Promise<ConfigurationSnapshot> {
    const pop=await this.db.prepare(`SELECT row_count,content_bytes,revision FROM configuration_admission_population
      WHERE tenant_id=? AND family=? LIMIT 1`).bind(this.scope.tenantId,family)
      .first<{row_count:number;content_bytes:number;revision:number}>();
    const population:ConfigurationPopulation=pop
      ? {exists:true,rowCount:pop.row_count,contentBytes:pop.content_bytes,revision:pop.revision}
      : {exists:false,rowCount:0,contentBytes:0,revision:0};
    if(![population.rowCount,population.contentBytes,population.revision].every(safeCount))throw new Error('Invalid configuration population');
    if(targetId===undefined)return{family,population};
    if(family!=='automation')throw new Error('Invalid configuration target');
    const row=await this.db.prepare(`SELECT a.id,m.content_bytes,m.revision FROM automation_rules a
      LEFT JOIN automation_admission_targets m ON m.tenant_id=a.tenant_id AND m.automation_id=a.id
      WHERE a.tenant_id=? AND a.id=? LIMIT 1`).bind(this.scope.tenantId,targetId)
      .first<{id:string;content_bytes:number|null;revision:number|null}>();
    if(!row){
      const stray=await this.db.prepare(`SELECT 1 AS present FROM automation_admission_targets WHERE tenant_id=? AND automation_id=? LIMIT 1`)
        .bind(this.scope.tenantId,targetId).first();
      if(stray)throw new Error('Invalid automation target counter');
      return{family,population,target:{exists:false,contentBytes:0,revision:0}};
    }
    if(!safeCount(row.content_bytes)||!safeCount(row.revision))throw new Error('Invalid automation target counter');
    return{family,population,target:{exists:true,contentBytes:row.content_bytes,revision:row.revision}};
  }

  async findActive(ns:ConfigurationNamespace):Promise<ConfigurationReceipt|null> {
    if(ns.principalId!==this.scope.actorId)return null;
    const receipt=await this.db.prepare(`SELECT payload_hash,response_status,response_bytes,reserved_d1_rows_read FROM configuration_mutation_receipts
      WHERE ${namespaceWhere} AND expires_at>unixepoch()`).bind(...namespaceValues(this.scope,ns)).first<ConfigurationReceipt>();
    if(receipt&&(!safeCount(receipt.response_bytes)||!safeCount(receipt.reserved_d1_rows_read)||receipt.reserved_d1_rows_read<4096))
      throw new Error('Invalid configuration receipt');
    return receipt;
  }

  private fence(commit:ConfigurationCommit,snapshot:ConfigurationSnapshot):D1PreparedStatement[] {
    const population=populationConstraint(this.scope,snapshot),statements=configurationFenceStatements(this.db,this.scope,commit);
    statements.push(this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1 AND (${population.sql})
      THEN 1 ELSE 0 END WHERE tenant_id=?`).bind(...population.values,this.scope.tenantId));
    return statements;
  }

  private targetFence(id:string,target:AutomationTarget):D1PreparedStatement {
    const constraint=targetConstraint(this.scope,id,target);
    return this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1 AND (${constraint.sql})
      THEN 1 ELSE 0 END WHERE tenant_id=?`).bind(...constraint.values,this.scope.tenantId);
  }

  private cleanup(ns:ConfigurationNamespace):D1PreparedStatement[] {
    return [this.db.prepare(`DELETE FROM configuration_mutation_receipts WHERE ${namespaceWhere} AND expires_at<=unixepoch()
        AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`)
        .bind(...namespaceValues(this.scope,ns),this.scope.tenantId),
      this.db.prepare(`DELETE FROM configuration_mutation_receipts WHERE rowid IN (SELECT rowid FROM configuration_mutation_receipts
        WHERE tenant_id=? AND principal_id=? AND expires_at<=unixepoch() ORDER BY expires_at LIMIT 16)
        AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`)
        .bind(this.scope.tenantId,ns.principalId,this.scope.tenantId)];
  }

  private assertion():D1PreparedStatement {
    return this.db.prepare(`SELECT accepted FROM budget_mutation_assertion WHERE tenant_id=?`).bind(this.scope.tenantId);
  }

  async listTicketFields(commit:ConfigurationCommit,snapshot:ConfigurationSnapshot):Promise<TicketFieldRow[]> {
    if(snapshot.family!=='ticket-field')throw new Error('Invalid configuration family');
    const statements=this.fence(commit,snapshot);
    statements.push(this.db.prepare(`SELECT * FROM ticket_fields WHERE tenant_id=?
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1) ORDER BY name ASC`)
      .bind(this.scope.tenantId,this.scope.tenantId),this.assertion());
    const result=await this.db.batch<TicketFieldRow|{accepted:number}>(statements);
    if((result.at(-1)?.results[0] as any)?.accepted!==1)throw new Error('Ticket-field list changed');
    return result.at(-2)?.results as TicketFieldRow[]??[];
  }

  async listAutomations(commit:ConfigurationCommit,snapshot:ConfigurationSnapshot):Promise<AutomationRow[]> {
    if(snapshot.family!=='automation')throw new Error('Invalid configuration family');
    const statements=this.fence(commit,snapshot);
    statements.push(this.db.prepare(`SELECT * FROM automation_rules WHERE tenant_id=?
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1) ORDER BY created_at DESC`)
      .bind(this.scope.tenantId,this.scope.tenantId),this.assertion());
    const result=await this.db.batch<AutomationRow|{accepted:number}>(statements);
    if((result.at(-1)?.results[0] as any)?.accepted!==1)throw new Error('Automation list changed');
    return result.at(-2)?.results as AutomationRow[]??[];
  }

  async replay(commit:ConfigurationCommit,ns:ConfigurationNamespace,receipt:ConfigurationReceipt):Promise<string> {
    const statements=configurationFenceStatements(this.db,this.scope,commit);
    statements.push(this.db.prepare(`SELECT response_snapshot FROM configuration_mutation_receipts WHERE ${namespaceWhere}
      AND payload_hash=? AND response_status=? AND response_bytes=? AND reserved_d1_rows_read=? AND expires_at>unixepoch()
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1) LIMIT 1`)
      .bind(...namespaceValues(this.scope,ns),receipt.payload_hash,receipt.response_status,receipt.response_bytes,
        receipt.reserved_d1_rows_read,this.scope.tenantId),this.assertion());
    const result=await this.db.batch<{response_snapshot:string}|{accepted:number}>(statements);
    const response=(result.at(-2)?.results[0] as {response_snapshot?:string}|undefined)?.response_snapshot;
    if((result.at(-1)?.results[0] as any)?.accepted!==1||response===undefined)throw new Error('Configuration replay was not admitted');
    return response;
  }

  async createTicketField(commit:ConfigurationCommit,snapshot:ConfigurationSnapshot,row:TicketFieldRow):Promise<string> {
    if(!commit.namespace||commit.namespace.operation!=='dashboard.ticket-field.create'||snapshot.family!=='ticket-field'||!safeCount(commit.businessD1RowsRead))throw new Error('Missing configuration namespace');
    const statements=this.fence(commit,snapshot);
    statements.push(...this.cleanup(commit.namespace));
    statements.push(this.db.prepare(`INSERT INTO ticket_fields(tenant_id,id,name,label,field_type,options,is_active)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`)
      .bind(row.tenant_id,row.id,row.name,row.label,row.field_type,row.options,row.is_active?1:0,this.scope.tenantId));
    statements.push(this.db.prepare(`INSERT INTO configuration_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_bytes,reserved_d1_rows_read,response_snapshot)
      SELECT ?,?,?,?,?,201,length(CAST(body.snapshot AS BLOB)),?,body.snapshot FROM
      (SELECT json_object('tenant_id',f.tenant_id,'id',f.id,'name',f.name,'label',f.label,
        'field_type',f.field_type,'options',f.options,'is_active',f.is_active) snapshot
      FROM ticket_fields f WHERE f.tenant_id=? AND f.id=?) body
      WHERE 1=1
        AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
      RETURNING response_snapshot`).bind(...namespaceValues(this.scope,commit.namespace),commit.namespace.payloadHash,commit.businessD1RowsRead,
        this.scope.tenantId,row.id,this.scope.tenantId));
    const result=await this.db.batch<{response_snapshot:string}>(statements),response=result.at(-1)?.results[0]?.response_snapshot;
    if(!response)throw new Error('Ticket-field create was not admitted');
    return response;
  }

  async createAutomation(commit:ConfigurationCommit,snapshot:ConfigurationSnapshot,row:Omit<AutomationRow,'created_at'>):Promise<string> {
    if(!commit.namespace||commit.namespace.operation!=='dashboard.automation.create'||snapshot.family!=='automation'||!safeCount(commit.businessD1RowsRead))throw new Error('Missing configuration namespace');
    const statements=this.fence(commit,snapshot);
    statements.push(...this.cleanup(commit.namespace));
    statements.push(this.db.prepare(`INSERT INTO automation_rules(tenant_id,id,name,event_type,conditions,action_type,action_config,is_active)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`)
      .bind(row.tenant_id,row.id,row.name,row.event_type,row.conditions,row.action_type,row.action_config,row.is_active?1:0,this.scope.tenantId));
    statements.push(this.db.prepare(`INSERT INTO configuration_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_bytes,reserved_d1_rows_read,response_snapshot)
      SELECT ?,?,?,?,?,201,length(CAST(body.snapshot AS BLOB)),?,body.snapshot FROM
      (SELECT json_object('tenant_id',a.tenant_id,'id',a.id,'name',a.name,'event_type',a.event_type,
        'conditions',a.conditions,'action_type',a.action_type,'action_config',a.action_config,'is_active',a.is_active,'created_at',a.created_at)
        snapshot FROM automation_rules a WHERE a.tenant_id=? AND a.id=?) body
      WHERE 1=1
        AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
      RETURNING response_snapshot`).bind(...namespaceValues(this.scope,commit.namespace),commit.namespace.payloadHash,commit.businessD1RowsRead,
        this.scope.tenantId,row.id,this.scope.tenantId));
    const result=await this.db.batch<{response_snapshot:string}>(statements),response=result.at(-1)?.results[0]?.response_snapshot;
    if(!response)throw new Error('Automation create was not admitted');
    return response;
  }

  async updateAutomation(commit:ConfigurationCommit,id:string,snapshot:ConfigurationSnapshot,data:Record<string,unknown>):Promise<string> {
    if(!commit.namespace||commit.namespace.operation!=='dashboard.automation.update'||snapshot.family!=='automation'||!snapshot.target||!safeCount(commit.businessD1RowsRead))throw new Error('Missing configuration namespace');
    const fields=['name','event_type','conditions','action_type','action_config','is_active'] as const;
    const supplied=fields.map(field=>data[field]!==undefined);
    const values=fields.flatMap((field,index)=>[supplied[index]?1:0,field==='is_active'?(data[field]?1:0):data[field]??null]);
    const statements=this.fence(commit,snapshot);
    statements.push(this.targetFence(id,snapshot.target),...this.cleanup(commit.namespace));
    if(supplied.some(Boolean))statements.push(this.db.prepare(`UPDATE automation_rules SET
      name=CASE WHEN ?=1 THEN ? ELSE name END,event_type=CASE WHEN ?=1 THEN ? ELSE event_type END,
      conditions=CASE WHEN ?=1 THEN ? ELSE conditions END,action_type=CASE WHEN ?=1 THEN ? ELSE action_type END,
      action_config=CASE WHEN ?=1 THEN ? ELSE action_config END,is_active=CASE WHEN ?=1 THEN ? ELSE is_active END
      WHERE tenant_id=? AND id=? AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`)
      .bind(...values,this.scope.tenantId,id,this.scope.tenantId));
    statements.push(this.db.prepare(`INSERT INTO configuration_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_bytes,reserved_d1_rows_read,response_snapshot)
      SELECT ?,?,?,?,?,200,length(CAST(body.snapshot AS BLOB)),?,body.snapshot FROM
      (SELECT COALESCE((SELECT json_object('tenant_id',a.tenant_id,'id',a.id,'name',a.name,
        'event_type',a.event_type,'conditions',a.conditions,'action_type',a.action_type,'action_config',a.action_config,
        'is_active',a.is_active,'created_at',a.created_at) FROM automation_rules a WHERE a.tenant_id=? AND a.id=?),'null') snapshot) body
      WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
      RETURNING response_snapshot`).bind(...namespaceValues(this.scope,commit.namespace),commit.namespace.payloadHash,commit.businessD1RowsRead,
        this.scope.tenantId,id,this.scope.tenantId));
    const result=await this.db.batch<{response_snapshot:string}>(statements),response=result.at(-1)?.results[0]?.response_snapshot;
    if(!response)throw new Error('Automation update changed');
    return response;
  }

  async deleteAutomation(commit:ConfigurationCommit,id:string,snapshot:ConfigurationSnapshot):Promise<string> {
    if(!commit.namespace||commit.namespace.operation!=='dashboard.automation.delete'||snapshot.family!=='automation'||!snapshot.target||!safeCount(commit.businessD1RowsRead))throw new Error('Missing configuration namespace');
    const statements=this.fence(commit,snapshot);
    statements.push(this.targetFence(id,snapshot.target),...this.cleanup(commit.namespace));
    statements.push(this.db.prepare(`DELETE FROM automation_rules WHERE tenant_id=? AND id=?
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`)
      .bind(this.scope.tenantId,id,this.scope.tenantId));
    statements.push(this.db.prepare(`INSERT INTO configuration_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_bytes,reserved_d1_rows_read,response_snapshot)
      SELECT ?,?,?,?,?,200,length(CAST('{"success":true}' AS BLOB)),?,'{"success":true}' WHERE EXISTS
        (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
        AND NOT EXISTS (SELECT 1 FROM automation_rules WHERE tenant_id=? AND id=?)
      RETURNING response_snapshot`).bind(...namespaceValues(this.scope,commit.namespace),commit.namespace.payloadHash,commit.businessD1RowsRead,
        this.scope.tenantId,this.scope.tenantId,id));
    const result=await this.db.batch<{response_snapshot:string}>(statements),response=result.at(-1)?.results[0]?.response_snapshot;
    if(!response)throw new Error('Automation delete changed');
    return response;
  }
}
