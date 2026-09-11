import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { resolveCapability, type CapabilityWriteFence } from '../auth/capability-policy';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { VerifiedTenantScope } from '../types/tenant';
import { budgetCommitConstraint, budgetGrantOperationStatements } from './budget-commit-fence';
import { MAX_SESSION_BUDGET_GROUPS, type SessionBudgetCredential } from './session-budget-authority.repository';

export type GroupDirectoryOperation = 'directory.users.list'|'directory.agents.list'|'directory.groups.list'|'directory.group.members.list'
  |'directory.group.create'|'directory.group.delete'|'directory.group.member.add'|'directory.group.member.remove';
export type GroupDirectoryPopulation = Readonly<{ kind: 'tenant-users'|'tenant-groups'|'group-members'; count: number; groupId?: string }>;
export type GroupDirectoryTarget = Readonly<{ groupId?: string; userId?: string; page?: number; limit?: number;
  role?: string | null; name?: string; description?: string | null }>;
export type GroupDirectoryCommit = Readonly<{ operation: GroupDirectoryOperation; requestKey: string; credential: SessionBudgetCredential;
  target: GroupDirectoryTarget; capability?: CapabilityWriteFence; population?: GroupDirectoryPopulation; authority: BudgetCommitAuthority }>;

type SqlConstraint = Readonly<{ sql: string; values: unknown[] }>;
export class GroupDirectoryFenceError extends Error {}

function boundedCapabilityConstraint(f:CapabilityWriteFence,scope:VerifiedTenantScope):SqlConstraint {
  const groups=`SELECT m.group_id,r.enabled,r.revision FROM
    (SELECT group_id FROM user_groups WHERE tenant_id=? AND user_id=? ORDER BY group_id COLLATE BINARY LIMIT ${MAX_SESSION_BUDGET_GROUPS+1}) m
    LEFT JOIN tenant_group_capability_constraints r ON r.tenant_id=? AND r.group_id=m.group_id AND r.capability=?`;
  const groupValues=[scope.tenantId,scope.actorId,scope.tenantId,f.capability];
  return {sql:`EXISTS (SELECT 1 FROM deployment_capability_ceiling o
    JOIN deployment_role_capability_grants r ON r.capability=o.capability AND r.role=?
    LEFT JOIN tenant_role_capability_policies t ON t.tenant_id=? AND t.role=? AND t.capability=o.capability
    WHERE o.capability=? AND o.enabled=1 AND r.enabled=1 AND (?<>'agent' OR t.enabled=1)
      AND (SELECT count(*) FROM (${groups}))<=${MAX_SESSION_BUDGET_GROUPS}
      AND NOT EXISTS (SELECT 1 FROM (${groups}) WHERE enabled=0)
      AND json_array(o.revision,r.revision,CASE WHEN ?='agent' THEN t.revision ELSE NULL END,
        json((SELECT json_group_array(json_array(group_id,revision)) FROM (${groups} ORDER BY m.group_id COLLATE BINARY) WHERE enabled IS NOT NULL)),CAST(? AS INTEGER))=?)`,
  values:[f.role,scope.tenantId,f.role,f.capability,f.role,...groupValues,...groupValues,f.role,...groupValues,f.sessionVersion,f.policyFingerprint]};
}

export class GroupDirectoryRepository {
  constructor(private readonly scope: VerifiedTenantScope, private readonly db: D1Database) {}

  /** Bounded replacement for the legacy unbounded group-constraint permission read on these routes. */
  async capabilityFence(credential:SessionBudgetCredential,legacyKey:'users'|'groups'):Promise<CapabilityWriteFence|null>{
    const capability=resolveCapability(legacyKey);
    if(!capability||credential.tenantId!==this.scope.tenantId||credential.actorId!==this.scope.actorId
      ||credential.sessionVersion!==this.scope.authVersion||!this.scope.roles.includes(credential.role))return null;
    const [userResult,policyResult,groupResult]=await this.db.batch([
      this.db.prepare('SELECT role,session_version FROM users WHERE tenant_id=? AND id=? LIMIT 1')
        .bind(this.scope.tenantId,this.scope.actorId),
      this.db.prepare(`SELECT o.enabled AS owner_enabled,o.revision AS owner_revision,r.enabled AS role_enabled,r.revision AS role_revision,
        t.enabled AS tenant_enabled,t.revision AS tenant_revision FROM deployment_capability_ceiling o
        LEFT JOIN deployment_role_capability_grants r ON r.capability=o.capability AND r.role=?
        LEFT JOIN tenant_role_capability_policies t ON t.tenant_id=? AND t.role=? AND t.capability=o.capability
        WHERE o.capability=? LIMIT 1`).bind(credential.role,this.scope.tenantId,credential.role,capability.id),
      this.db.prepare(`SELECT m.group_id,r.enabled,r.revision FROM
        (SELECT group_id FROM user_groups WHERE tenant_id=? AND user_id=? ORDER BY group_id COLLATE BINARY LIMIT ${MAX_SESSION_BUDGET_GROUPS+1}) m
        LEFT JOIN tenant_group_capability_constraints r ON r.tenant_id=? AND r.group_id=m.group_id AND r.capability=?
        ORDER BY m.group_id COLLATE BINARY`).bind(this.scope.tenantId,this.scope.actorId,this.scope.tenantId,capability.id),
    ]);
    const user=userResult.results[0] as {role:string;session_version:number}|undefined;
    const policy=policyResult.results[0] as {owner_enabled:number;owner_revision:number;role_enabled:number|null;role_revision:number|null;
      tenant_enabled:number|null;tenant_revision:number|null}|undefined;
    const groups=groupResult.results as {group_id:string;enabled:number|null;revision:number|null}[];
    if(!user||user.role!==credential.role||user.session_version!==credential.sessionVersion||!policy||policy.owner_enabled!==1||policy.role_enabled!==1
      ||(credential.role==='agent'&&policy.tenant_enabled!==1)||groups.length>MAX_SESSION_BUDGET_GROUPS||groups.some(group=>group.enabled===0))return null;
    const constrained=groups.filter(group=>group.enabled!==null);
    return Object.freeze({tenantId:this.scope.tenantId,actorId:this.scope.actorId,role:credential.role,sessionVersion:credential.sessionVersion,
      capability:capability.id,policyFingerprint:JSON.stringify([policy.owner_revision,policy.role_revision,
        credential.role==='agent'?policy.tenant_revision:null,constrained.map(group=>[group.group_id,group.revision]),credential.sessionVersion])});
  }

  async population(operation: GroupDirectoryOperation, groupId?: string): Promise<GroupDirectoryPopulation | undefined> {
    if (operation === 'directory.users.list' || operation === 'directory.agents.list') {
      const row=await this.db.prepare('SELECT user_count FROM group_directory_tenant_population WHERE tenant_id=?')
        .bind(this.scope.tenantId).first<{user_count:number}>();
      return this.checkedPopulation('tenant-users',row?.user_count??0);
    }
    if (operation === 'directory.groups.list') {
      const row=await this.db.prepare('SELECT group_count FROM group_directory_tenant_population WHERE tenant_id=?')
        .bind(this.scope.tenantId).first<{group_count:number}>();
      return this.checkedPopulation('tenant-groups',row?.group_count??0);
    }
    if (operation === 'directory.group.members.list' || operation === 'directory.group.delete') {
      if (!groupId) throw new Error('Group population target is required');
      const row=await this.db.prepare('SELECT member_count FROM group_directory_member_population WHERE tenant_id=? AND group_id=?')
        .bind(this.scope.tenantId,groupId).first<{member_count:number}>();
      return this.checkedPopulation('group-members',row?.member_count??0,groupId);
    }
    return undefined;
  }

  private checkedPopulation(kind: GroupDirectoryPopulation['kind'],count:number,groupId?:string): GroupDirectoryPopulation {
    if (!Number.isSafeInteger(count)||count<0) throw new Error('Invalid group directory population');
    return {kind,count,...(groupId?{groupId}:{})};
  }

  private authority(commit:GroupDirectoryCommit,operation:GroupDirectoryOperation,target:GroupDirectoryTarget):SqlConstraint {
    const c=commit.credential;
    const valid=commit.operation===operation&&JSON.stringify(commit.target)===JSON.stringify(target)
      &&commit.requestKey===commit.authority.operationFingerprint&&c.tenantId===this.scope.tenantId&&c.actorId===this.scope.actorId
      &&this.scope.roles.includes(c.role)&&c.sessionVersion===this.scope.authVersion&&c.mfaVerified===true
      &&Number.isSafeInteger(c.sessionVersion)&&Number.isSafeInteger(c.expiresAt)&&commit.authority.operationId.length>0&&commit.authority.operationFingerprint.length>0
      &&(!commit.capability||(commit.capability.tenantId===c.tenantId&&commit.capability.actorId===c.actorId&&commit.capability.role===c.role&&commit.capability.sessionVersion===c.sessionVersion));
    const budget=budgetCommitConstraint(commit.authority,this.scope.tenantId);
    const sql=[`?=1`,`EXISTS (SELECT 1 FROM users WHERE tenant_id=? AND id=? AND role=? AND session_version=? AND mfa_enabled=1 AND ?>unixepoch())`,budget.sql];
    const values:unknown[]=[valid?1:0,this.scope.tenantId,c.actorId,c.role,c.sessionVersion,c.expiresAt,...budget.values];
    if(commit.capability){const capability=boundedCapabilityConstraint(commit.capability,this.scope);sql.push(capability.sql);values.push(...capability.values);}
    const p=commit.population;
    if(p?.kind==='tenant-users'){sql.push(`COALESCE((SELECT user_count FROM group_directory_tenant_population WHERE tenant_id=?),0)<=?`);values.push(this.scope.tenantId,p.count);}
    else if(p?.kind==='tenant-groups'){sql.push(`COALESCE((SELECT group_count FROM group_directory_tenant_population WHERE tenant_id=?),0)<=?`);values.push(this.scope.tenantId,p.count);}
    else if(p?.kind==='group-members'){
      sql.push(`?=1 AND COALESCE((SELECT member_count FROM group_directory_member_population WHERE tenant_id=? AND group_id=?),0)<=?`);
      values.push(p.groupId&&p.groupId===target.groupId?1:0,this.scope.tenantId,p.groupId??'',p.count);
    }
    const expectsPopulation=operation==='directory.users.list'||operation==='directory.agents.list'||operation==='directory.groups.list'
      ||operation==='directory.group.members.list'||operation==='directory.group.delete';
    if(expectsPopulation!==Boolean(p))sql.push('0');
    const expectsCapability=operation==='directory.users.list'||operation==='directory.group.create'||operation==='directory.group.delete'
      ||operation==='directory.group.member.add'||operation==='directory.group.member.remove';
    if(expectsCapability!==Boolean(commit.capability))sql.push('0');
    return {sql:sql.join(' AND '),values};
  }

  private guard(commit:GroupDirectoryCommit,operation:GroupDirectoryOperation,target:GroupDirectoryTarget):D1PreparedStatement {
    const authority=this.authority(commit,operation,target);
    return this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
      VALUES (?,CASE WHEN ${authority.sql} THEN 1 ELSE 0 END)
      ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId,...authority.values);
  }

  private async batch(commit:GroupDirectoryCommit,operation:GroupDirectoryOperation,target:GroupDirectoryTarget,statements:D1PreparedStatement[]) {
    try{return await this.db.batch([this.guard(commit,operation,target),...budgetGrantOperationStatements(this.db,this.scope,commit.authority),...statements]);}
    catch{throw new GroupDirectoryFenceError('Group directory authority changed');}
  }

  async listUsers(input:{page:number;limit:number;role?:string},commit:GroupDirectoryCommit):Promise<any[]> {
    if(!Number.isSafeInteger(input.page)||input.page<1||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100)throw new Error('Invalid user page');
    const offset=(input.page-1)*input.limit;if(!Number.isSafeInteger(offset))throw new Error('Invalid user page');
    let sql='SELECT id,email,full_name,role,mfa_enabled,created_at FROM users WHERE tenant_id=?';const values:unknown[]=[this.scope.tenantId];
    if(input.role){sql+=' AND role=?';values.push(input.role);}
    sql+=' ORDER BY created_at DESC,id LIMIT ? OFFSET ?';values.push(input.limit,offset);
    const target={page:input.page,limit:input.limit,role:input.role??null};
    const results=await this.batch(commit,'directory.users.list',target,[this.db.prepare(sql).bind(...values)]);return results[3].results??[];
  }

  async listAllStaff(commit:GroupDirectoryCommit):Promise<any[]> {
    const results=await this.batch(commit,'directory.agents.list',{},[this.db.prepare(`SELECT id,email,full_name,role,mfa_enabled,created_at
      FROM users WHERE tenant_id=? AND role IN ('admin','agent') ORDER BY created_at DESC,id`).bind(this.scope.tenantId)]);
    return results[3].results??[];
  }

  async listGroups(commit:GroupDirectoryCommit):Promise<any[]> {
    const results=await this.batch(commit,'directory.groups.list',{},[this.db.prepare('SELECT * FROM groups WHERE tenant_id=? ORDER BY created_at,id').bind(this.scope.tenantId)]);
    return results[3].results??[];
  }

  async members(groupId:string,commit:GroupDirectoryCommit):Promise<{group:any;members:any[]}|null>{
    const results=await this.batch(commit,'directory.group.members.list',{groupId},[
      this.db.prepare('SELECT * FROM groups WHERE tenant_id=? AND id=?').bind(this.scope.tenantId,groupId),
      this.db.prepare(`SELECT u.id,u.email,u.full_name,u.role FROM user_groups ug JOIN users u
        ON u.tenant_id=ug.tenant_id AND u.id=ug.user_id WHERE ug.tenant_id=? AND ug.group_id=? ORDER BY u.created_at,u.id`)
        .bind(this.scope.tenantId,groupId),
    ]);
    const group=results[3].results?.[0];return group?{group,members:results[4].results??[]}:null;
  }

  async createGroup(data:{name:string;description?:string|null},commit:GroupDirectoryCommit):Promise<any|null>{
    const description=data.description??null;const id=crypto.randomUUID();
    const results=await this.batch(commit,'directory.group.create',{name:data.name,description},[this.db.prepare(`INSERT OR IGNORE INTO groups
      (tenant_id,id,name,description) VALUES (?,?,?,?) RETURNING *`).bind(this.scope.tenantId,id,data.name,description)]);
    return results[3].results?.[0]??null;
  }

  async deleteGroup(id:string,commit:GroupDirectoryCommit):Promise<'deleted'|'missing'|'has_tickets'>{
    const exists='EXISTS (SELECT 1 FROM groups WHERE tenant_id=? AND id=?)';const noTickets='NOT EXISTS (SELECT 1 FROM tickets WHERE tenant_id=? AND group_id=? LIMIT 1)';
    const results=await this.batch(commit,'directory.group.delete',{groupId:id},[
      this.db.prepare('SELECT 1 AS present FROM groups WHERE tenant_id=? AND id=?').bind(this.scope.tenantId,id),
      this.db.prepare('SELECT 1 AS present FROM tickets WHERE tenant_id=? AND group_id=? LIMIT 1').bind(this.scope.tenantId,id),
      this.db.prepare(`DELETE FROM user_groups WHERE tenant_id=? AND group_id=? AND ${exists} AND ${noTickets}`)
        .bind(this.scope.tenantId,id,this.scope.tenantId,id,this.scope.tenantId,id),
      this.db.prepare(`DELETE FROM groups WHERE tenant_id=? AND id=? AND ${noTickets} RETURNING id`)
        .bind(this.scope.tenantId,id,this.scope.tenantId,id),
    ]);
    if(!results[3].results?.[0])return'missing';if(results[4].results?.[0])return'has_tickets';
    if(!results[6].results?.[0])throw new GroupDirectoryFenceError('Group delete did not commit');return'deleted';
  }

  async addMember(groupId:string,userId:string,commit:GroupDirectoryCommit):Promise<'added'|'missing_group'|'missing_user'|'already_member'>{
    const results=await this.batch(commit,'directory.group.member.add',{groupId,userId},[
      this.db.prepare('SELECT 1 AS present FROM groups WHERE tenant_id=? AND id=?').bind(this.scope.tenantId,groupId),
      this.db.prepare('SELECT 1 AS present FROM users WHERE tenant_id=? AND id=?').bind(this.scope.tenantId,userId),
      this.db.prepare(`INSERT OR IGNORE INTO user_groups(tenant_id,user_id,group_id)
        SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM groups WHERE tenant_id=? AND id=?)
          AND EXISTS (SELECT 1 FROM users WHERE tenant_id=? AND id=?) RETURNING group_id`)
        .bind(this.scope.tenantId,userId,groupId,this.scope.tenantId,groupId,this.scope.tenantId,userId),
    ]);
    if(!results[3].results?.[0])return'missing_group';if(!results[4].results?.[0])return'missing_user';
    return results[5].results?.[0]?'added':'already_member';
  }

  async removeMember(groupId:string,userId:string,commit:GroupDirectoryCommit):Promise<boolean>{
    const results=await this.batch(commit,'directory.group.member.remove',{groupId,userId},[this.db.prepare(`DELETE FROM user_groups
      WHERE tenant_id=? AND user_id=? AND group_id=? RETURNING group_id`).bind(this.scope.tenantId,userId,groupId)]);
    return Boolean(results[3].results?.[0]);
  }
}
