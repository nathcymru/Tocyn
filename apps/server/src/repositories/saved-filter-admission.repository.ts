import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { SessionBudgetCredential, SessionBudgetRequirements } from './session-budget-authority.repository';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import { staffMutationStatements } from './staff-ticket-mutation.repository';

export type SavedFilterOperation = 'dashboard.filter.list' | 'dashboard.filter.get' |
  'dashboard.filter.create' | 'dashboard.filter.update' | 'dashboard.filter.delete';
export type SavedFilterMutationOperation = Extract<SavedFilterOperation, `${string}.create` | `${string}.update` | `${string}.delete`>;
export type SavedFilterNamespace = Readonly<{ principalId: string; operation: SavedFilterMutationOperation; keyHash: string; payloadHash: string }>;
export type SavedFilterCommit = Readonly<{ credential: SessionBudgetCredential; requirements: SessionBudgetRequirements;
  authority: BudgetCommitAuthority; namespace?: SavedFilterNamespace }>;
export type SavedFilterRow = Readonly<{ tenant_id: string; id: string; name: string; conditions: string;
  is_system: number | boolean; created_at: string | null; updated_at: string | null }>;
export type SavedFilterPopulation = Readonly<{ exists: boolean; filterRows: number; conditionBytes: number; revision: number }>;
export type SavedFilterTarget = Readonly<{ exists: boolean; conditionBytes: number; revision: number; isSystem?: boolean }>;
export type SavedFilterSnapshot = Readonly<{ population: SavedFilterPopulation; target?: SavedFilterTarget }>;
export type SavedFilterReceipt = Readonly<{ payload_hash: string; response_status: 200 | 201; response_snapshot: string }>;

const nsWhere = 'tenant_id=? AND principal_id=? AND operation=? AND key_hash=?';
const nsValues = (scope: VerifiedTenantScope, ns: SavedFilterNamespace) => [scope.tenantId,ns.principalId,ns.operation,ns.keyHash];
const safeCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);

function populationConstraint(scope: VerifiedTenantScope, snapshot: SavedFilterPopulation): { sql: string; values: unknown[] } {
  return snapshot.exists ? {
    sql: `EXISTS (SELECT 1 FROM saved_filter_population WHERE tenant_id=? AND filter_rows=? AND condition_bytes=? AND revision=?)`,
    values: [scope.tenantId,snapshot.filterRows,snapshot.conditionBytes,snapshot.revision],
  } : {
    sql: `NOT EXISTS (SELECT 1 FROM saved_filter_population WHERE tenant_id=?)
      AND NOT EXISTS (SELECT 1 FROM ticket_filters WHERE tenant_id=?)`,
    values: [scope.tenantId,scope.tenantId],
  };
}

function targetConstraint(scope: VerifiedTenantScope, id: string, target: SavedFilterTarget): { sql: string; values: unknown[] } {
  return target.exists ? {
    sql: `EXISTS (SELECT 1 FROM ticket_list_filter_scan_counters c JOIN ticket_filters f
      ON f.tenant_id=c.tenant_id AND f.id=c.filter_id WHERE c.tenant_id=? AND c.filter_id=?
      AND c.condition_bytes=? AND c.revision=?)`,
    values: [scope.tenantId,id,target.conditionBytes,target.revision],
  } : {
    sql: `NOT EXISTS (SELECT 1 FROM ticket_filters WHERE tenant_id=? AND id=?)
      AND NOT EXISTS (SELECT 1 FROM ticket_list_filter_scan_counters WHERE tenant_id=? AND filter_id=?)`,
    values: [scope.tenantId,id,scope.tenantId,id],
  };
}

/** Adds the exact durable operation link after the current-session/capability/budget assertion. */
export function savedFilterFenceStatements(db: D1Database, scope: VerifiedTenantScope, commit: SavedFilterCommit): D1PreparedStatement[] {
  const base = staffMutationStatements(db,scope,{credential:commit.credential,requirements:commit.requirements,authority:commit.authority})[0];
  const grant=commit.authority.grant;
  const linked=!!grant && [grant.tenantId,grant.aggregateId,grant.reservationId,grant.holderId,grant.operationId,grant.operationFingerprint].every(identity)
    && grant.tenantId===scope.tenantId && grant.operationId===commit.authority.operationId
    && grant.operationFingerprint===commit.authority.operationFingerprint;
  const operation=db.prepare(`INSERT INTO budget_grant_operations
    (tenant_id,reservation_id,holder_id,operation_id,aggregate_id,operation_fingerprint,operation_envelope_json)
    SELECT ?,?,?,?,?,?,? WHERE ?=1
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
      AND NOT EXISTS (SELECT 1 FROM budget_grant_closures
      WHERE tenant_id=? AND reservation_id=? AND holder_id=?)
    ON CONFLICT(tenant_id,reservation_id,holder_id,operation_id) DO UPDATE SET operation_id=excluded.operation_id
      WHERE aggregate_id=excluded.aggregate_id AND operation_fingerprint=excluded.operation_fingerprint
        AND operation_envelope_json=excluded.operation_envelope_json`)
    .bind(scope.tenantId,grant?.reservationId??'',grant?.holderId??'',grant?.operationId??'',grant?.aggregateId??'',
      grant?.operationFingerprint??'',JSON.stringify(grant?.operationEnvelope??{}),linked?1:0,
      scope.tenantId,scope.tenantId,grant?.reservationId??'',grant?.holderId??'');
  const exact=db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1
    AND NOT EXISTS (SELECT 1 FROM budget_grant_closures
    WHERE tenant_id=? AND reservation_id=? AND holder_id=?) AND EXISTS (SELECT 1 FROM budget_grant_operations
    WHERE tenant_id=? AND reservation_id=? AND holder_id=? AND operation_id=? AND aggregate_id=?
      AND operation_fingerprint=? AND operation_envelope_json=?) THEN 1 ELSE 0 END WHERE tenant_id=?`)
    .bind(scope.tenantId,grant?.reservationId??'',grant?.holderId??'',scope.tenantId,grant?.reservationId??'',grant?.holderId??'',grant?.operationId??'',grant?.aggregateId??'',
      grant?.operationFingerprint??'',JSON.stringify(grant?.operationEnvelope??{}),scope.tenantId);
  return [base,operation,exact];
}

export class SavedFilterAdmissionRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  async snapshot(id?: string): Promise<SavedFilterSnapshot> {
    const pop=await this.db.prepare(`SELECT filter_rows,condition_bytes,revision FROM saved_filter_population WHERE tenant_id=? LIMIT 1`)
      .bind(this.scope.tenantId).first<{filter_rows:number;condition_bytes:number;revision:number}>();
    const population: SavedFilterPopulation=pop
      ? {exists:true,filterRows:pop.filter_rows,conditionBytes:pop.condition_bytes,revision:pop.revision}
      : {exists:false,filterRows:0,conditionBytes:0,revision:0};
    if (![population.filterRows,population.conditionBytes,population.revision].every(safeCount)) throw new Error('Invalid saved-filter population');
    if (id===undefined) return {population};
    const row=await this.db.prepare(`SELECT f.is_system,c.condition_bytes AS counter_condition_bytes,c.revision AS counter_revision
      FROM ticket_filters f LEFT JOIN ticket_list_filter_scan_counters c ON c.tenant_id=f.tenant_id AND c.filter_id=f.id
      WHERE f.tenant_id=? AND f.id=? LIMIT 1`).bind(this.scope.tenantId,id).first<{is_system:number|boolean;counter_condition_bytes:number|null;counter_revision:number|null}>();
    if (!row) {
      const stray=await this.db.prepare(`SELECT 1 AS present FROM ticket_list_filter_scan_counters WHERE tenant_id=? AND filter_id=? LIMIT 1`)
        .bind(this.scope.tenantId,id).first();
      if (stray) throw new Error('Invalid saved-filter target counter');
      return {population,target:{exists:false,conditionBytes:0,revision:0}};
    }
    if (!safeCount(row.counter_condition_bytes)||!safeCount(row.counter_revision)) throw new Error('Invalid saved-filter target counter');
    return {population,target:{exists:true,conditionBytes:row.counter_condition_bytes,revision:row.counter_revision,
      isSystem:row.is_system===1||row.is_system===true}};
  }

  async findActive(ns: SavedFilterNamespace): Promise<SavedFilterReceipt|null> {
    if (ns.principalId!==this.scope.actorId) return null;
    return this.db.prepare(`SELECT payload_hash,response_status,response_snapshot FROM saved_filter_mutation_receipts
      WHERE ${nsWhere} AND expires_at>unixepoch()`).bind(...nsValues(this.scope,ns)).first<SavedFilterReceipt>();
  }

  private fence(commit: SavedFilterCommit, snapshot: SavedFilterSnapshot): D1PreparedStatement[] {
    const population=populationConstraint(this.scope,snapshot.population);
    const statements=savedFilterFenceStatements(this.db,this.scope,commit);
    statements.push(this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1 AND (${population.sql}) THEN 1 ELSE 0 END WHERE tenant_id=?`)
      .bind(...population.values,this.scope.tenantId));
    return statements;
  }

  async list(commit: SavedFilterCommit, snapshot: SavedFilterSnapshot): Promise<SavedFilterRow[]> {
    const statements=this.fence(commit,snapshot);
    statements.push(this.db.prepare(`SELECT * FROM ticket_filters WHERE tenant_id=?
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
      ORDER BY is_system DESC,created_at ASC`).bind(this.scope.tenantId,this.scope.tenantId));
    statements.push(this.db.prepare(`SELECT accepted FROM budget_mutation_assertion WHERE tenant_id=?`).bind(this.scope.tenantId));
    const result=await this.db.batch<SavedFilterRow|{accepted:number}>(statements);
    if ((result.at(-1)?.results[0] as any)?.accepted!==1) throw new Error('Saved-filter read was not admitted');
    return result.at(-2)?.results as SavedFilterRow[] ?? [];
  }

  async get(commit: SavedFilterCommit, id: string, snapshot: SavedFilterSnapshot): Promise<SavedFilterRow|null> {
    if (!snapshot.target) throw new Error('Missing saved-filter target');
    const target=targetConstraint(this.scope,id,snapshot.target);
    const statements=this.fence(commit,snapshot);
    statements.push(this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1 AND (${target.sql}) THEN 1 ELSE 0 END WHERE tenant_id=?`)
      .bind(...target.values,this.scope.tenantId));
    statements.push(this.db.prepare(`SELECT * FROM ticket_filters WHERE tenant_id=? AND id=?
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1) LIMIT 1`).bind(this.scope.tenantId,id,this.scope.tenantId));
    statements.push(this.db.prepare(`SELECT accepted FROM budget_mutation_assertion WHERE tenant_id=?`).bind(this.scope.tenantId));
    const result=await this.db.batch<SavedFilterRow|{accepted:number}>(statements);
    if ((result.at(-1)?.results[0] as any)?.accepted!==1) throw new Error('Saved-filter read changed');
    return (result.at(-2)?.results[0] as SavedFilterRow|undefined) ?? null;
  }

  private cleanup(ns: SavedFilterNamespace): D1PreparedStatement[] {
    return [this.db.prepare(`DELETE FROM saved_filter_mutation_receipts WHERE ${nsWhere} AND expires_at<=unixepoch()
        AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`).bind(...nsValues(this.scope,ns),this.scope.tenantId),
      this.db.prepare(`DELETE FROM saved_filter_mutation_receipts WHERE rowid IN (SELECT rowid FROM saved_filter_mutation_receipts
        WHERE tenant_id=? AND principal_id=? AND expires_at<=unixepoch() ORDER BY expires_at LIMIT 32)
        AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`).bind(this.scope.tenantId,ns.principalId,this.scope.tenantId)];
  }

  private receipt(ns: SavedFilterNamespace, status: 200|201, snapshot: string, conditionSql: string, values: unknown[]): D1PreparedStatement {
    return this.db.prepare(`INSERT INTO saved_filter_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_snapshot)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
        AND (${conditionSql}) RETURNING response_snapshot`)
      .bind(...nsValues(this.scope,ns),ns.payloadHash,status,snapshot,this.scope.tenantId,...values);
  }

  async create(commit: SavedFilterCommit, measured: SavedFilterSnapshot, row: SavedFilterRow, response: string): Promise<string> {
    if (!commit.namespace) throw new Error('Missing mutation namespace');
    const statements=this.fence(commit,measured);
    statements.push(...this.cleanup(commit.namespace));
    statements.push(this.db.prepare(`INSERT INTO ticket_filters(tenant_id,id,name,conditions,is_system,created_at,updated_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`)
      .bind(row.tenant_id,row.id,row.name,row.conditions,0,row.created_at,row.updated_at,this.scope.tenantId));
    statements.push(this.receipt(commit.namespace,201,response,
      `EXISTS (SELECT 1 FROM ticket_filters WHERE tenant_id=? AND id=? AND name=? AND conditions=? AND is_system=0)`,
      [this.scope.tenantId,row.id,row.name,row.conditions]));
    const results=await this.db.batch<{response_snapshot:string}>(statements);
    const value=results.at(-1)?.results[0]?.response_snapshot;
    if (!value) throw new Error('Saved-filter create was not admitted');
    return value;
  }

  async update(commit: SavedFilterCommit, id: string, measured: SavedFilterSnapshot,
    data: Readonly<{name:string;conditions:string;updatedAt:string}>): Promise<string> {
    if (!commit.namespace||!measured.target) throw new Error('Missing mutation namespace');
    const target=targetConstraint(this.scope,id,measured.target), statements=this.fence(commit,measured);
    statements.push(this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1 AND (${target.sql}) THEN 1 ELSE 0 END WHERE tenant_id=?`)
      .bind(...target.values,this.scope.tenantId),...this.cleanup(commit.namespace));
    statements.push(this.db.prepare(`UPDATE ticket_filters SET name=?,conditions=?,updated_at=? WHERE tenant_id=? AND id=? AND is_system=0
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`)
      .bind(data.name,data.conditions,data.updatedAt,this.scope.tenantId,id,this.scope.tenantId));
    statements.push(this.db.prepare(`INSERT INTO saved_filter_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_snapshot)
      SELECT ?,?,?,?,?,200,json_object('tenant_id',f.tenant_id,'id',f.id,'name',f.name,'conditions',json(f.conditions),
        'is_system',f.is_system,'created_at',f.created_at,'updated_at',f.updated_at)
      FROM ticket_filters f WHERE f.tenant_id=? AND f.id=? AND f.name=? AND f.conditions=? AND f.is_system=0 AND f.updated_at=?
        AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
      RETURNING response_snapshot`).bind(...nsValues(this.scope,commit.namespace),commit.namespace.payloadHash,
        this.scope.tenantId,id,data.name,data.conditions,data.updatedAt,this.scope.tenantId));
    const results=await this.db.batch<{response_snapshot:string}>(statements),value=results.at(-1)?.results[0]?.response_snapshot;
    if (!value) throw new Error('Saved-filter update changed');
    return value;
  }

  async delete(commit: SavedFilterCommit, id: string, measured: SavedFilterSnapshot, response: string): Promise<string> {
    if (!commit.namespace||!measured.target) throw new Error('Missing mutation namespace');
    const target=targetConstraint(this.scope,id,measured.target),statements=this.fence(commit,measured);
    statements.push(this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1 AND (${target.sql}) THEN 1 ELSE 0 END WHERE tenant_id=?`)
      .bind(...target.values,this.scope.tenantId),...this.cleanup(commit.namespace));
    statements.push(this.db.prepare(`DELETE FROM ticket_filters WHERE tenant_id=? AND id=? AND is_system=0
      AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`)
      .bind(this.scope.tenantId,id,this.scope.tenantId));
    statements.push(this.receipt(commit.namespace,200,response,
      `NOT EXISTS (SELECT 1 FROM ticket_filters WHERE tenant_id=? AND id=?)`,[this.scope.tenantId,id]));
    const results=await this.db.batch<{response_snapshot:string}>(statements),value=results.at(-1)?.results[0]?.response_snapshot;
    if (!value) throw new Error('Saved-filter delete changed');
    return value;
  }
}
