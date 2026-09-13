import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { TicketQueueKey } from '../types/ticket-queue';
import { ticketQueuePredicate } from './ticket-queue-predicate';
import { TicketListScanError, ticketListScanFenceSql, ticketListCurrentCredentialSql, type TicketListScanSnapshot, type TicketListCurrentCredential } from './ticket-list-scan.repository';

export type TicketListPredicateOptions = Readonly<{
  filterId?:string;status?:string;priority?:string;assignedTo?:string;groupId?:string;ticketNo?:string;search?:string;customerEmail?:string;
  queue?:TicketQueueKey;draftNotExpiredAt?:string;viewer?:Readonly<{role:'admin'|'agent';actorId:string}>;
  scanFence?:TicketListScanSnapshot;currentCredential?:TicketListCurrentCredential;
}>;
/** One canonical predicate for ordinary pages and complete SLA queue snapshots. */
export async function ticketListPredicate(db:D1Database,scope:VerifiedTenantScope,options:TicketListPredicateOptions){
  let where = 'tenant_id = ?';
  const params:unknown[] = [scope.tenantId];
    if (options.viewer?.role === 'agent') {
      const visible = "(group_id IS NULL OR EXISTS (SELECT 1 FROM user_groups membership WHERE membership.tenant_id = tickets.tenant_id AND membership.user_id = ? AND membership.group_id = tickets.group_id))";
      where += ` AND ${visible}`;
      params.push(options.viewer.actorId);
    }

    if (options.customerEmail) {
      where += " AND customer_email = ?";
      params.push(options.customerEmail);
    }

    if (options.queue) {
      if (['drafts', 'mine', 'unassigned', 'mentions'].includes(options.queue) && (!options.viewer || options.viewer.actorId !== scope.actorId
        || !scope.roles.includes(options.viewer.role) || !['admin', 'agent'].includes(options.viewer.role))) {
        throw new Error('Queue requires the current operator');
      }
      const queue = ticketQueuePredicate(options.queue, 'tickets', options.queue === 'drafts' || options.queue === 'mine' || options.queue === 'mentions'
        ? { actorId: scope.actorId, notExpiredAt: options.draftNotExpiredAt } : undefined);
      where += ` AND ${queue.sql}`;
      params.push(...queue.values);
    }

    if (options.search) {
      const numericMatch = options.search.match(/\d+/);
      const searchPattern = `%${options.search}%`;

      let searchCondition = "(subject LIKE ? OR customer_email LIKE ? OR id LIKE ? OR EXISTS (SELECT 1 FROM articles WHERE articles.tenant_id = tickets.tenant_id AND ticket_id = tickets.id AND (snippet LIKE ? OR body LIKE ?)))";
      const searchParams = [searchPattern, searchPattern, searchPattern, searchPattern, searchPattern];

      if (numericMatch) {
        searchCondition = `(${searchCondition} OR CAST(ticket_no AS TEXT) LIKE ?)`;
        const numPattern = `%${numericMatch[0]}%`;
        searchParams.push(numPattern);
      }

      where += ` AND ${searchCondition}`;
      params.push(...searchParams);
    }

    if (options.filterId) {
      const snapshotFilter = options.scanFence?.filter;
      const filter = snapshotFilter?.exists
        ? await db.prepare(`SELECT tf.conditions FROM ticket_filters tf WHERE tf.tenant_id=? AND tf.id=? AND EXISTS
          (SELECT 1 FROM ticket_list_filter_scan_counters f WHERE f.tenant_id=tf.tenant_id AND f.filter_id=tf.id
            AND f.condition_bytes<=? AND f.revision=?)`).bind(scope.tenantId, options.filterId, snapshotFilter.conditionBytes, snapshotFilter.revision).first<{ conditions: string }>()
        : snapshotFilter ? null : await db.prepare("SELECT conditions FROM ticket_filters WHERE tenant_id = ? AND id = ?")
          .bind(scope.tenantId, options.filterId).first<{ conditions: string }>();
      if (snapshotFilter?.exists && !filter) throw new TicketListScanError('fence_changed');

      if (filter) {
        try {
          const conditions = JSON.parse(filter.conditions);
          if (Array.isArray(conditions)) {
            for (const condition of conditions) {
              const { field, operator, value } = condition;
              // Prevent SQL injection by allowing only specific fields
              const allowedFields = ["status", "priority", "assigned_to", "group_id", "source", "subject", "customer_email", "ticket_no"];
              if (allowedFields.includes(field)) {
                if (operator === "in" && typeof value === "string" && value.length > 0) {
                  const vals = value.split(",");
                  where += ` AND ${field} IN (${vals.map(() => "?").join(",")})`;
                  params.push(...vals);
                } else if (operator === "in" && Array.isArray(value) && value.length > 0) {
                  where += ` AND ${field} IN (${value.map(() => "?").join(",")})`;
                  params.push(...value);
                } else if (operator === "equals" && value !== undefined && value !== null) {
                  where += ` AND ${field} = ?`;
                  params.push(value);
                } else if (operator === "not_equals" && value !== undefined && value !== null) {
                  where += ` AND ${field} != ?`;
                  params.push(value);
                } else if (operator === "contains" && typeof value === "string" && value.length > 0) {
                  where += ` AND ${field} LIKE ?`;
                  params.push(`%${value}%`);
                }
              }
            }
          }
        } catch (e) {
          throw new Error("Invalid saved filter");
        }
      } else {
        where += " AND 0=1";
      }
    } else {
      if (options.status) {
        const statuses = options.status.split(",");
        where += ` AND status IN (${statuses.map(() => "?").join(",")})`;
        params.push(...statuses);
      }
      if (options.priority) {
        const priorities = options.priority.split(",");
        where += ` AND priority IN (${priorities.map(() => "?").join(",")})`;
        params.push(...priorities);
      }
      if (options.assignedTo) {
        where += " AND assigned_to = ?";
        params.push(options.assignedTo);
      }
      if (options.groupId) {
        where += " AND group_id = ?";
        params.push(options.groupId);
      }
      if (options.ticketNo) {
        where += " AND ticket_no = ?";
        params.push(parseInt(options.ticketNo));
      }
    }

    const scanFence = options.scanFence ? ticketListScanFenceSql(options.scanFence) : undefined;
    if (scanFence) {
      where += ` AND ${scanFence.sql}`;
      params.push(...scanFence.values);
    }
    const current = options.currentCredential ? ticketListCurrentCredentialSql(scope.tenantId, scope.actorId, options.currentCredential) : undefined;

    if (current) { where += ` AND ${current.sql}`; params.push(...current.values); }
    return {sql:where,params,scanFence,current};
}
