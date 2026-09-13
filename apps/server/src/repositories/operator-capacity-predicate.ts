import type { D1Database } from '@cloudflare/workers-types';
import { OPERATOR_CAPACITY_MAX } from '../types/operator-capacity';

/** Covering indexed probe stops at overflow; no actor visibility can undercount admission. */
export function operatorCapacityLoadSql(tenantSql:string,ownerSql:string):string {
  return `(SELECT count(*) FROM (SELECT id FROM tickets INDEXED BY idx_tickets_capacity_load
    WHERE tenant_id=${tenantSql} AND assigned_to=${ownerSql} AND status IN ('open','pending') LIMIT ${OPERATOR_CAPACITY_MAX+1}))`;
}
/** Same-owner no-ops and unassignment do not consume a new slot. Absent policy preserves manual behavior. */
export function operatorCapacityAssignmentSql(ticketAlias:string,ownerSql:string,overrideSql='0'):string {
  return `(${ownerSql} IS NULL OR ${ticketAlias}.assigned_to IS ${ownerSql} OR NOT EXISTS
    (SELECT 1 FROM operator_capacity cp WHERE cp.tenant_id=${ticketAlias}.tenant_id AND cp.user_id=${ownerSql}) OR EXISTS
    (SELECT 1 FROM operator_capacity cp WHERE cp.tenant_id=${ticketAlias}.tenant_id AND cp.user_id=${ownerSql}
      AND (${overrideSql}=1 OR (cp.availability='available' AND
        ${operatorCapacityLoadSql('cp.tenant_id','cp.user_id')}<cp.assignment_ceiling))))`;
}

/** One fixed assertion used by API/staff creation and audited assignment surfaces. */
export function capacityAssignmentStatement(db:D1Database,tenantId:string,ownerId:string|null,ticketId:string|null){
  return db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) SELECT ?,CASE WHEN
    ${operatorCapacityAssignmentSql('target','target.id')} THEN 1 ELSE 0 END
    FROM (SELECT ? AS tenant_id,? AS id,(SELECT assigned_to FROM tickets WHERE tenant_id=? AND id=?) AS assigned_to) target WHERE 1
    ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`)
    .bind(tenantId,tenantId,ownerId,tenantId,ticketId);
}
