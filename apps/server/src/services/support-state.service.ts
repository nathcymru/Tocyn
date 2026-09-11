import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import type { ConversationActor } from '../types/conversation-audit';
import type {
  SupportStateDeactivation,
  SupportStateDefinitionInput,
  SupportStateDefinitionUpdate,
  SupportStateTransition,
  TicketSupportState,
} from '../types/support-state';
import type { CapabilityWriteFence } from '../auth/capability-policy';
import { SupportStateError } from '../repositories/support-state.repository';

/**
 * Tenant-scoped orchestration behind the authenticated dashboard routes. Every
 * caller still passes through the established request composition and group gate.
 */
export class SupportStateService {
  constructor(private readonly deps: TenantRequestDeps) {}

  private staffActor(): ConversationActor {
    if (!this.deps.scope.roles.some(role => role === 'admin' || role === 'agent')) {
      throw new SupportStateError('invalid', 'Support-state operations require a staff session');
    }
    return { kind: 'staff', id: this.deps.scope.actorId, source: 'dashboard' };
  }

  private async assertLiveStaff(): Promise<ConversationActor> {
    const actor = this.staffActor();
    await this.deps.repositories.supportStates.captureTicketWriteFence(this.deps.credential?.sessionVersion);
    return actor;
  }

  private async ticketActor(ticketId: string): Promise<ConversationActor> {
    const actor = this.staffActor();
    const ticket = await this.deps.repositories.tickets.get(ticketId);
    if (!ticket) throw new SupportStateError('not_found', 'Ticket not found');
    if (this.deps.scope.roles.includes('agent') && ticket.group_id &&
      !await this.deps.repositories.groups.isMember(ticket.group_id, this.deps.scope.actorId)) {
      throw new SupportStateError('not_found', 'Ticket not found');
    }
    return actor;
  }

  async listDefinitions(limit = 100, includeInactive = false) {
    await this.assertLiveStaff();
    return this.deps.repositories.supportStates.listDefinitions(limit, includeInactive);
  }

  async getTicketState(ticketId: string) {
    await this.ticketActor(ticketId);
    return this.deps.repositories.supportStates.getTicketState(ticketId);
  }

  async createDefinition(input: SupportStateDefinitionInput, fence: CapabilityWriteFence) {
    return this.deps.repositories.supportStates.createDefinition(input, await this.assertLiveStaff(), fence);
  }

  async updateDefinition(id: string, input: SupportStateDefinitionUpdate, fence: CapabilityWriteFence) {
    return this.deps.repositories.supportStates.updateDefinition(id, input, await this.assertLiveStaff(), fence);
  }

  async transition(ticketId: string, input: SupportStateTransition): Promise<TicketSupportState> {
    const actor = await this.ticketActor(ticketId);
    const fence = await this.deps.repositories.supportStates.captureTicketWriteFence(this.deps.credential?.sessionVersion);
    await this.deps.betaAdmission?.authorize('conversation');
    return this.deps.repositories.supportStates.transition(ticketId, input, actor, fence);
  }

  async deactivate(id: string, input: SupportStateDeactivation, fence: CapabilityWriteFence): Promise<void> {
    if (await this.deps.repositories.supportStates.countReferences(id) > 100) {
      throw new SupportStateError('conflict', 'Support-state remapping requires a bounded background job');
    }
    await this.deps.betaAdmission?.authorize('conversation');
    return this.deps.repositories.supportStates.deactivate(id, input, await this.assertLiveStaff(), fence);
  }
}
