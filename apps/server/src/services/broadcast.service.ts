import { VerifiedTenantScope } from '../types/tenant';
import { Env } from '../bindings';
import { measureResourceOperation, ResourceOperationEmitter } from '../observability/resource-operation';
import { MAX_NOTIFICATION_BROADCAST_ATTEMPTS } from '../durable_objects/notification-limits';

/** Service-visible delivery outcome; canonical mutation success is independent. */
export interface BroadcastDeliveryResult {
  status: 'accepted' | 'failed' | 'disabled';
  attempts: number;
}

function recordFailure(): void {
  try { console.error('Broadcast failed'); } catch { /* Diagnostics cannot invalidate an already committed mutation. */ }
}

export class BroadcastService {
  constructor(private env: Env, private scope?: VerifiedTenantScope, private emit?: ResourceOperationEmitter) {}

  /**
   * Never throw a delivery failure after the caller's canonical commit. The
   * result and fixed diagnostics expose failure; user-visible receipt/recovery
   * integration is separate. A 2xx acknowledges DO processing, not a client ACK.
   */
  async broadcast(type: string, payload: any, retries = 2): Promise<BroadcastDeliveryResult> {
    if (!this.env.NOTIFICATION_DO) return { status: 'disabled', attempts: 0 };
    if (!this.scope?.tenantId) throw new Error('Verified tenant scope required for broadcasts');
    const maxAttempts = Number.isSafeInteger(retries) && retries >= 0
      ? Math.min(retries, MAX_NOTIFICATION_BROADCAST_ATTEMPTS - 1) + 1 : 1;
    let body: string;
    try { body = JSON.stringify({ type, payload }); }
    catch { recordFailure(); return { status: 'failed', attempts: 0 }; }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let retryable = true;
      try {
        const id = this.env.NOTIFICATION_DO.idFromName(`tenant:${this.scope.tenantId}`);
        const obj = this.env.NOTIFICATION_DO.get(id);
        const response = await measureResourceOperation({ resource: 'durable_object', operation: 'invoke', emit: this.emit,
          execute: () => obj.fetch('http://do/broadcast', {
            method: 'POST', body, redirect: 'manual', headers: { 'Content-Type': 'application/json' },
          }), isFailureResult: response => !response.ok });
        if (response.ok) return { status: 'accepted', attempts: attempt };
        // Permanent denials and redirects cannot become accepted delivery. Only
        // transport failures and server errors use the bounded retry allowance.
        retryable = response.status >= 500 && response.status <= 599;
      } catch { /* Transport failure; never expose exception details or payloads. */ }
      recordFailure();
      if (!retryable || attempt === maxAttempts) return { status: 'failed', attempts: attempt };
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return { status: 'failed', attempts: maxAttempts };
  }

  async notifyTicketCreated(ticket: any) {
    return this.broadcast('ticket.created', {
      id: ticket.id,
      ticket_no: ticket.ticket_no,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
    });
  }

  async notifyTicketUpdated(ticket: any) {
    return this.broadcast('ticket.updated', {
      id: ticket.id,
      ticket_no: ticket.ticket_no,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
    });
  }

  async notifyPresenceUpdate(userId: string, name: string, location: string | null, status: 'online' | 'offline') {
    return this.broadcast('presence.update', {
      userId,
      name,
      location,
      status,
    });
  }
}
