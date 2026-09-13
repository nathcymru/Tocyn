import type { LocalBetaAdmissionRepository } from './local-beta-admission.repository';
import { capacityFingerprint } from '../budgets/operator-capacity-admission.service';
import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { SessionBudgetCredential } from './session-budget-authority.repository';
import type { OperatorCapacity, OperatorCapacityInput } from '../types/operator-capacity';
import { operatorCapacityLoadSql } from './operator-capacity-predicate';
import { budgetCommitConstraint, budgetGrantOperationStatements } from './budget-commit-fence';
import { ticketListCurrentCredentialSql } from './ticket-list-scan.repository';

export type CapacityOperation='operator.capacity.read'|'operator.capacity.write';
export type CapacityCommit=Readonly<{operation:CapacityOperation;targetId:string;input?:OperatorCapacityInput;
  credential:SessionBudgetCredential;authority:BudgetCommitAuthority}>;
export class OperatorCapacityError extends Error {
  constructor(readonly status:403|409|503,readonly code:string){super(code);}
}
export class OperatorCapacityRepository {
  constructor(private readonly db:D1Database,private readonly scope:VerifiedTenantScope,private readonly beta?:LocalBetaAdmissionRepository){}
  async execute(commit:CapacityCommit,now:string):Promise<OperatorCapacity>{
    const c=commit.credential,input=commit.input,write=commit.operation==='operator.capacity.write';
    if(c.tenantId!==this.scope.tenantId||c.actorId!==this.scope.actorId||c.sessionVersion!==this.scope.authVersion
      ||!this.scope.roles.includes(c.role)||!c.mfaVerified|| (c.role!=='admin'&&(write||commit.targetId!==c.actorId))
      ||write!==!!input||commit.targetId.length>128||this.scope.tenantId.length>256||this.scope.actorId.length>256
      ||(input&&(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>=Number.MAX_SAFE_INTEGER)))throw new OperatorCapacityError(403,'capacity_access_denied');
    if(commit.authority.operationFingerprint!==await capacityFingerprint(commit.operation,this.scope.tenantId,c.actorId,commit.targetId,input))
      throw new OperatorCapacityError(403,'capacity_access_denied');
    const live=ticketListCurrentCredentialSql(this.scope.tenantId,this.scope.actorId,c);
    const budget=budgetCommitConstraint(commit.authority,this.scope.tenantId);
    const guard=this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
      VALUES (?,CASE WHEN ${live.sql} AND ${budget.sql} AND EXISTS(SELECT 1 FROM users
        WHERE tenant_id=? AND id=? AND role IN ('admin','agent')) THEN 1 ELSE 0 END)
      ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`)
      .bind(this.scope.tenantId,...live.values,...budget.values,this.scope.tenantId,commit.targetId);
    const statements=[guard,...budgetGrantOperationStatements(this.db,this.scope,commit.authority)];
    let writeIndex=-1;
    if(input){
      statements.push(...(this.beta?.conditionalConfigurationStatements({sql:`(?=0 AND NOT EXISTS(SELECT 1 FROM operator_capacity WHERE tenant_id=? AND user_id=?)) OR EXISTS(SELECT 1 FROM operator_capacity WHERE tenant_id=? AND user_id=? AND revision=?)`,
        values:[input.expectedRevision,this.scope.tenantId,commit.targetId,this.scope.tenantId,commit.targetId,input.expectedRevision]})??[]));
      writeIndex=statements.length;
      statements.push(this.db.prepare(`INSERT INTO operator_capacity(tenant_id,user_id,revision,availability,assignment_ceiling,updated_at,updated_by)
        SELECT ?,?,1,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM operator_capacity WHERE tenant_id=? AND user_id=? AND revision=?)
        ON CONFLICT(tenant_id,user_id) DO UPDATE SET revision=operator_capacity.revision+1,availability=excluded.availability,
          assignment_ceiling=excluded.assignment_ceiling,updated_at=excluded.updated_at,updated_by=excluded.updated_by
        WHERE operator_capacity.revision=? RETURNING revision`)
        .bind(this.scope.tenantId,commit.targetId,input.availability,input.assignmentCeiling,now,c.actorId,input.expectedRevision,
          this.scope.tenantId,commit.targetId,input.expectedRevision,input.expectedRevision));
    }
    statements.push(this.db.prepare(`SELECT u.id,p.revision,p.availability,p.assignment_ceiling,
      ${operatorCapacityLoadSql('u.tenant_id','u.id')} AS current_work
      FROM users u LEFT JOIN operator_capacity p ON p.tenant_id=u.tenant_id AND p.user_id=u.id
      WHERE u.tenant_id=? AND u.id=?`).bind(this.scope.tenantId,commit.targetId));
    const results=await this.db.batch(statements);
    if(input&&!results[writeIndex]?.results?.[0])throw new OperatorCapacityError(409,'capacity_revision_conflict');
    const row=results.at(-1)?.results?.[0] as {id:string;revision:number|null;availability:'available'|'unavailable'|null;assignment_ceiling:number|null;current_work:number}|undefined;
    if(!row)throw new OperatorCapacityError(503,'capacity_unavailable');
    return {userId:row.id,revision:row.revision??0,availability:row.availability,assignmentCeiling:row.assignment_ceiling,
      currentWork:row.current_work>1000?null:row.current_work,status:row.current_work>1000?'unavailable':row.revision===null?'unconfigured':'available',
      definitionVersion:'2026-09-11.3',asOf:now};
  }
}
