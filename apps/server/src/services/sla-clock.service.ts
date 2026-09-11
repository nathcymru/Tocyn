import type { CapabilityWriteFence } from '../auth/capability-policy';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import type { SlaPolicyInput } from '../types/sla';
import { SlaClockError } from '../repositories/sla-clock.repository';

export class SlaClockService {
  constructor(private readonly deps: TenantRequestDeps) {}

  private async assertLiveStaff() {
    if (!this.deps.scope.roles.some(role => role === 'admin' || role === 'agent')) {
      throw new SlaClockError('not_found', 'SLA policy not found');
    }
    return this.deps.repositories.supportStates.captureTicketWriteFence(this.deps.credential?.sessionVersion);
  }

  async getPolicy() { await this.assertLiveStaff(); return this.deps.repositories.slaClocks.getPolicy(); }
  async setPolicy(input: SlaPolicyInput, fence: CapabilityWriteFence) {
    await this.assertLiveStaff();
    return this.deps.repositories.slaClocks.setPolicy(input, fence);
  }

  async getTicketProjection(ticketId: string) {
    await this.assertLiveStaff();
    const ticket = await this.deps.repositories.tickets.get(ticketId);
    if (!ticket || (this.deps.scope.roles.includes('agent') && ticket.group_id
      && !await this.deps.repositories.groups.isMember(ticket.group_id, this.deps.scope.actorId))) {
      throw new SlaClockError('not_found', 'Ticket not found');
    }
    return this.deps.repositories.slaClocks.getProjection(ticketId);
  }

  async getTicketProjections(ticketIds: readonly string[]) {
    const unique = [...new Set(ticketIds)];
    if (!unique.length || unique.length > 25 || unique.some(id => !id || id.length > 120)) throw new SlaClockError('invalid', 'SLA projection batches contain 1 to 25 ticket IDs');
    const result: Record<string, Awaited<ReturnType<typeof this.deps.repositories.slaClocks.getProjection>>> = {};
    for (const ticketId of unique) {
      try { const projection = await this.getTicketProjection(ticketId); if (projection) result[ticketId] = projection; }
      catch (error) { if (!(error instanceof SlaClockError) || error.code !== 'not_found') throw error; }
    }
    return result;
  }

  async initializeExistingTicket(ticketId: string) {
    const fence = await this.assertLiveStaff();
    const ticket = await this.deps.repositories.tickets.get(ticketId);
    if (!ticket || (this.deps.scope.roles.includes('agent') && ticket.group_id
      && !await this.deps.repositories.groups.isMember(ticket.group_id, this.deps.scope.actorId))) {
      throw new SlaClockError('not_found', 'Ticket not found');
    }
    return this.deps.repositories.slaClocks.initializeExistingTicket(ticketId, fence);
  }
}
