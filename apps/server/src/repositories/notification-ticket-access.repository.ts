import type { Env } from '../bindings';
import type { UserAuthResolution } from '../auth/user-auth-resolver';
import { createResourceOperationEmitter } from '../observability/resource-operation';
import { observeD1 } from './observed-d1';

/** Called only after NotificationDO verifies the current staff session and owning tenant object. */
export async function authorizeNotificationTicket(env: Env, tenantId: string, user: UserAuthResolution, ticketId: string): Promise<boolean> {
  const db = observeD1(env.DB, createResourceOperationEmitter(env));
  const ticket = await db.prepare('SELECT group_id FROM tickets WHERE tenant_id = ? AND id = ? LIMIT 1')
    .bind(tenantId, ticketId).first<{ group_id: string | null }>();
  if (!ticket) return false;
  if (user.role === 'admin' || ticket.group_id === null) return true;
  const membership = await db.prepare('SELECT 1 FROM user_groups WHERE tenant_id = ? AND user_id = ? AND group_id = ? LIMIT 1')
    .bind(tenantId, user.userId, ticket.group_id).first();
  return !!membership;
}
