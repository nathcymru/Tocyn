import type { D1Database,D1PreparedStatement } from '@cloudflare/workers-types';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import { budgetCommitConstraint,budgetGrantOperationConstraint } from './budget-commit-fence';
import type { SessionBudgetCredential,SessionBudgetRequirements } from './session-budget-authority.repository';
import type { User } from '../types';
import type { VerifiedTenantScope } from '../types/tenant';

export type StaffAuthSnapshot=Readonly<{mfaEnabled:boolean;pendingSecret:boolean}>;
export type StaffAuthCommit=Readonly<{credential:SessionBudgetCredential;requirements:SessionBudgetRequirements;authority:BudgetCommitAuthority;snapshot:StaffAuthSnapshot}>;

function validIdentity(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value);}

function credentialConstraint(scope:VerifiedTenantScope,commit:StaffAuthCommit):{sql:string;values:unknown[]}{
  const credential=commit.credential,stage=commit.requirements.authentication??'active';
  const trusted=credential.tenantId===scope.tenantId&&credential.actorId===scope.actorId&&scope.roles.includes(credential.role)
    &&credential.sessionVersion===scope.authVersion&&['admin','agent'].includes(credential.role)
    &&Number.isSafeInteger(credential.sessionVersion)&&Number.isSafeInteger(credential.expiresAt)
    &&(stage==='challenge'?credential.mfaVerified===false:stage==='enrollment'?typeof credential.mfaVerified==='boolean':credential.mfaVerified===true);
  return{sql:`?=1 AND EXISTS (SELECT 1 FROM users WHERE tenant_id=? AND id=? AND role=? AND session_version=?
      AND ?>unixepoch() AND (?<>'active' OR mfa_enabled=1) AND (mfa_enabled=1)=? AND (mfa_secret IS NOT NULL)=?)`,
    values:[trusted?1:0,scope.tenantId,scope.actorId,credential.role,credential.sessionVersion,credential.expiresAt,stage,
      commit.snapshot.mfaEnabled?1:0,commit.snapshot.pendingSecret?1:0]};
}

function initialFence(db:D1Database,scope:VerifiedTenantScope,commit:StaffAuthCommit):D1PreparedStatement[]{
  const credential=credentialConstraint(scope,commit),budget=budgetCommitConstraint(commit.authority,scope.tenantId),grant=commit.authority.grant;
  const linked=!!grant&&[grant.tenantId,grant.aggregateId,grant.reservationId,grant.holderId,grant.operationId,grant.operationFingerprint].every(validIdentity)
    &&grant.tenantId===scope.tenantId&&grant.operationId===commit.authority.operationId&&grant.operationFingerprint===commit.authority.operationFingerprint;
  const envelope=JSON.stringify(grant?.operationEnvelope??{});
  const assertion=db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
    VALUES(?,CASE WHEN ${credential.sql} AND ${budget.sql} THEN 1 ELSE 0 END)
    ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(scope.tenantId,...credential.values,...budget.values);
  const operation=db.prepare(`INSERT INTO budget_grant_operations
    (tenant_id,reservation_id,holder_id,operation_id,aggregate_id,operation_fingerprint,operation_envelope_json)
    SELECT ?,?,?,?,?,?,? WHERE ?=1 AND EXISTS(SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
      AND NOT EXISTS(SELECT 1 FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?)
    ON CONFLICT(tenant_id,reservation_id,holder_id,operation_id) DO UPDATE SET operation_id=excluded.operation_id
      WHERE aggregate_id=excluded.aggregate_id AND operation_fingerprint=excluded.operation_fingerprint
        AND operation_envelope_json=excluded.operation_envelope_json`).bind(scope.tenantId,grant?.reservationId??'',grant?.holderId??'',
      grant?.operationId??'',grant?.aggregateId??'',grant?.operationFingerprint??'',envelope,linked?1:0,scope.tenantId,
      scope.tenantId,grant?.reservationId??'',grant?.holderId??'');
  const exact=db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1
    AND NOT EXISTS(SELECT 1 FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?)
    AND EXISTS(SELECT 1 FROM budget_grant_operations WHERE tenant_id=? AND reservation_id=? AND holder_id=? AND operation_id=?
      AND aggregate_id=? AND operation_fingerprint=? AND operation_envelope_json=?) THEN 1 ELSE 0 END WHERE tenant_id=?`)
    .bind(scope.tenantId,grant?.reservationId??'',grant?.holderId??'',scope.tenantId,grant?.reservationId??'',grant?.holderId??'',
      grant?.operationId??'',grant?.aggregateId??'',grant?.operationFingerprint??'',envelope,scope.tenantId);
  return[assertion,operation,exact];
}

function continuationFence(db:D1Database,scope:VerifiedTenantScope,commit:StaffAuthCommit):D1PreparedStatement[]{
  const statements=initialFence(db,scope,commit);
  const operation=budgetGrantOperationConstraint(scope,commit.authority);
  statements.push(db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1 AND ${operation.sql}
    THEN 1 ELSE 0 END WHERE tenant_id=?`).bind(...operation.values,scope.tenantId));
  return statements;
}

export class StaffAuthAdmissionRepository{
  constructor(private readonly db:D1Database,private readonly scope:VerifiedTenantScope){}

  async snapshot():Promise<StaffAuthSnapshot|null>{
    const row=await this.db.prepare(`SELECT mfa_enabled,(mfa_secret IS NOT NULL) AS pending_secret FROM users
      WHERE tenant_id=? AND id=? LIMIT 1`).bind(this.scope.tenantId,this.scope.actorId)
      .first<{mfa_enabled:number|boolean;pending_secret:number|boolean}>();
    return row?{mfaEnabled:row.mfa_enabled===1||row.mfa_enabled===true,pendingSecret:row.pending_secret===1||row.pending_secret===true}:null;
  }

  async grantClosed(reservationId:string,holderId:string):Promise<boolean>{return!!await this.db.prepare(`SELECT 1 FROM budget_grant_closures
    WHERE tenant_id=? AND reservation_id=? AND holder_id=? LIMIT 1`).bind(this.scope.tenantId,reservationId,holderId).first();}

  async user(commit:StaffAuthCommit):Promise<User|null>{
    const statements=initialFence(this.db,this.scope,commit);
    statements.push(this.db.prepare(`SELECT * FROM users WHERE tenant_id=? AND id=?
      AND EXISTS(SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1) LIMIT 1`)
      .bind(this.scope.tenantId,this.scope.actorId,this.scope.tenantId));
    statements.push(this.db.prepare(`SELECT accepted FROM budget_mutation_assertion WHERE tenant_id=?`).bind(this.scope.tenantId));
    const results=await this.db.batch<User|{accepted:number}>(statements);
    if((results.at(-1)?.results[0] as {accepted?:number}|undefined)?.accepted!==1)throw new Error('Staff authentication authority changed');
    return(results.at(-2)?.results[0] as User|undefined)??null;
  }

  async beginMfaEnrollment(commit:StaffAuthCommit,encryptedSecret:string):Promise<User|null>{
    const statements=[...continuationFence(this.db,this.scope,commit),this.db.prepare(`UPDATE users SET mfa_secret=COALESCE(mfa_secret,?)
      WHERE tenant_id=? AND id=? AND mfa_enabled=0 AND session_version=?
        AND EXISTS(SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1) RETURNING *`)
      .bind(encryptedSecret,this.scope.tenantId,this.scope.actorId,commit.credential.sessionVersion,this.scope.tenantId),
      this.db.prepare(`SELECT accepted FROM budget_mutation_assertion WHERE tenant_id=?`).bind(this.scope.tenantId)];
    const results=await this.db.batch<User|{accepted:number}>(statements);
    if((results.at(-1)?.results[0] as {accepted?:number}|undefined)?.accepted!==1)throw new Error('Staff authentication authority changed');
    return(results.at(-2)?.results[0] as User|undefined)??null;
  }

  async completeMfaEnrollment(commit:StaffAuthCommit,expectedSecret:string):Promise<boolean>{
    const statements=[...continuationFence(this.db,this.scope,commit),this.db.prepare(`UPDATE users SET mfa_enabled=1
      WHERE tenant_id=? AND id=? AND mfa_enabled=0 AND mfa_secret=? AND session_version=?
        AND EXISTS(SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1) RETURNING id`)
      .bind(this.scope.tenantId,this.scope.actorId,expectedSecret,commit.credential.sessionVersion,this.scope.tenantId),
      this.db.prepare(`SELECT accepted FROM budget_mutation_assertion WHERE tenant_id=?`).bind(this.scope.tenantId)];
    const results=await this.db.batch<{id?:string;accepted?:number}>(statements);
    if(results.at(-1)?.results[0]?.accepted!==1)throw new Error('Staff authentication authority changed');
    return!!results.at(-2)?.results[0]?.id;
  }

  async revokeSessions(commit:StaffAuthCommit):Promise<boolean>{
    const statements=initialFence(this.db,this.scope,commit);
    statements.push(this.db.prepare(`UPDATE users SET session_version=session_version+1 WHERE tenant_id=? AND id=? AND session_version=?
      AND EXISTS(SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1) RETURNING id`)
      .bind(this.scope.tenantId,this.scope.actorId,commit.credential.sessionVersion,this.scope.tenantId));
    statements.push(this.db.prepare(`SELECT accepted FROM budget_mutation_assertion WHERE tenant_id=?`).bind(this.scope.tenantId));
    const results=await this.db.batch<{id?:string;accepted?:number}>(statements);
    if(results.at(-1)?.results[0]?.accepted!==1)throw new Error('Staff authentication authority changed');
    return!!results.at(-2)?.results[0]?.id;
  }
}
