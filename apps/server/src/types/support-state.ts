import type { Ticket } from './index';

export type SupportLifecycleCategory = Ticket['status'];

export type SupportStateDefinition = Readonly<{
  tenant_id: string;
  id: string;
  legacy_status: SupportLifecycleCategory;
  internal_label: string;
  public_label: string;
  waiting_reason_required: number;
  next_action_required: number;
  is_compatibility_default: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}>;

/** Private support-state facts. They are never added to legacy ticket payloads. */
export type TicketSupportState = Readonly<{
  ticket_id: string;
  definition_id: string;
  lifecycle: SupportLifecycleCategory;
  internal_label: string;
  public_label: string;
  waiting_reason: string | null;
  next_action: string | null;
  /** Shared ticket-level snooze deadline; NULL means not snoozed. */
  snoozed_until: string | null;
  /** Why this state is currently included in a queue projection. */
  resurface_reason: 'manual' | 'due' | 'customer_reply' | null;
  changed_at: string;
  revision: number;
}>;

/** Stable, label-free input consumed by the future #73 SLA policy. */
export type SupportStateSlaInput = Readonly<{
  lifecycle: SupportLifecycleCategory;
  waitingReasonPresent: boolean;
  nextActionPresent: boolean;
  changedAt: string;
}>;

/** Customer-safe projection: never carries internal labels or waiting facts. */
export type PublicSupportState = Readonly<{
  lifecycle: SupportLifecycleCategory;
  label: string;
  changedAt: string;
}>;

export type SupportStateTransition = Readonly<{
  definitionId: string;
  waitingReason?: string | null;
  nextAction?: string | null;
  /** Required monotonic optimistic-concurrency value from TicketSupportState.revision. */
  expectedRevision: number;
  snoozedUntil?: string | null;
}>;

export type SupportStateDefinitionInput = Readonly<{
  id: string;
  legacyStatus: SupportLifecycleCategory;
  internalLabel: string;
  publicLabel: string;
  waitingReasonRequired?: boolean;
  nextActionRequired?: boolean;
}>;

export type SupportStateDefinitionUpdate = Readonly<{
  internalLabel?: string;
  publicLabel?: string;
  waitingReasonRequired?: boolean;
  nextActionRequired?: boolean;
}>;

export type SupportStateDeactivation = Readonly<{
  replacementId: string;
  waitingReason?: string | null;
  nextAction?: string | null;
}>;

export function supportStateSlaInput(state: TicketSupportState): SupportStateSlaInput {
  return {
    lifecycle: state.lifecycle,
    waitingReasonPresent: state.waiting_reason !== null,
    nextActionPresent: state.next_action !== null,
    changedAt: state.changed_at,
  };
}

export function publicSupportState(state: TicketSupportState): PublicSupportState {
  return { lifecycle: state.lifecycle, label: state.public_label, changedAt: state.changed_at };
}
