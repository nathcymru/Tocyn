/** Pure #317 classification model. This does not replace the accepted calendar-aware SLA clocks. */
export const PRIORITY_CATEGORY_BASE = {
  'incidents-interruptions': 10,
  'security-privacy': 10,
  'access-authentication': 7,
  'technical-problems': 7,
  'service-requests': 4,
  'transactions-billing': 4,
  'status-follow-up': 4,
  'information-requests': 1,
  'how-to-assistance': 1,
  feedback: 1,
  other: 1,
} as const;

export type PriorityCategory = keyof typeof PRIORITY_CATEGORY_BASE;

export const PRIORITY_SCOPE_MULTIPLIER = {
  systemic: 3,
  localised: 2,
  isolated: 1,
} as const;

export type PriorityScope = keyof typeof PRIORITY_SCOPE_MULTIPLIER;

function assertCategory(value: PriorityCategory): void {
  if (!Object.prototype.hasOwnProperty.call(PRIORITY_CATEGORY_BASE, value)) {
    throw new RangeError('Unsupported priority category');
  }
}

function assertScope(value: PriorityScope): void {
  if (!Object.prototype.hasOwnProperty.call(PRIORITY_SCOPE_MULTIPLIER, value)) {
    throw new RangeError('Unsupported priority scope');
  }
}

export function calculatePriorityScore(
  category: PriorityCategory,
  scope: PriorityScope,
  urgencyModifierTotal: number,
): number {
  assertCategory(category);
  assertScope(scope);
  if (!Number.isSafeInteger(urgencyModifierTotal) || urgencyModifierTotal < 0) {
    throw new RangeError('Urgency modifier total must be a non-negative integer');
  }
  return PRIORITY_CATEGORY_BASE[category] * PRIORITY_SCOPE_MULTIPLIER[scope] + urgencyModifierTotal;
}

export const CONTRACT_TIER_WINDOW_HOURS = {
  alpha: 1,
  bravo: 4,
  charlie: 24,
  delta: 48,
} as const;

export type ContractTier = keyof typeof CONTRACT_TIER_WINDOW_HOURS;
export type CriticalityTier = 4 | 3 | 2 | 1;

export const CRITICALITY_TIER_WINDOW_HOURS: Readonly<Record<CriticalityTier, number>> = {
  4: 1,
  3: 4,
  2: 24,
  1: 48,
};

function assertContractTier(value: ContractTier): void {
  if (!Object.prototype.hasOwnProperty.call(CONTRACT_TIER_WINDOW_HOURS, value)) {
    throw new RangeError('Unsupported contract tier');
  }
}

function assertCriticalityTier(value: CriticalityTier): void {
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    throw new RangeError('Unsupported criticality tier');
  }
}

export function absoluteWindowHours(contractTier: ContractTier, criticalityTier: CriticalityTier): number {
  assertContractTier(contractTier);
  assertCriticalityTier(criticalityTier);
  return Math.min(CONTRACT_TIER_WINDOW_HOURS[contractTier], CRITICALITY_TIER_WINDOW_HOURS[criticalityTier]);
}

/** A percentage above 100 retains a negative overdue value; it is never clamped to zero. */
export function timeRemainingHours(
  contractTier: ContractTier,
  criticalityTier: CriticalityTier,
  elapsedPercentage: number,
): number {
  if (!Number.isFinite(elapsedPercentage) || elapsedPercentage < 0) {
    throw new RangeError('Elapsed percentage must be a finite non-negative number');
  }
  const window = absoluteWindowHours(contractTier, criticalityTier);
  return window - window * (elapsedPercentage / 100);
}

export type TimeTierWindowHours = 1 | 4 | 24 | 48;

/**
 * Classification for queue urgency only. It never changes a ticket's contract
 * tier, criticality tier, or accepted response/resolution SLA deadline.
 * The maintainer's 24h and 4h examples are inclusive at the threshold.
 */
export function effectiveUrgencyWindowHours(
  absoluteWindow: TimeTierWindowHours,
  timeRemaining: number,
): TimeTierWindowHours {
  if (![1, 4, 24, 48].includes(absoluteWindow) || !Number.isFinite(timeRemaining)) {
    throw new RangeError('Urgency window and remaining time must be valid');
  }
  for (const threshold of [1, 4, 24] as const) {
    if (threshold < absoluteWindow && timeRemaining <= threshold) return threshold;
  }
  return absoluteWindow;
}

export type PriorityView = 'default-focus' | 'criticality-matrix' | 'sla-commitment';

/** Snapshot data only; authority, clock source, status and pagination remain pending decisions. */
export interface PrioritySortTicket {
  ticketId: string;
  contractTier: ContractTier;
  criticalityTier: CriticalityTier;
  timeRemainingHours: number;
}

const CONTRACT_TIER_ORDER: Readonly<Record<ContractTier, number>> = {
  alpha: 0,
  bravo: 1,
  charlie: 2,
  delta: 3,
};

function compareTicketId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareRemaining(a: PrioritySortTicket, b: PrioritySortTicket): number {
  return a.timeRemainingHours - b.timeRemainingHours;
}

function compareCriticality(a: PrioritySortTicket, b: PrioritySortTicket): number {
  return b.criticalityTier - a.criticalityTier;
}

function compareContract(a: PrioritySortTicket, b: PrioritySortTicket): number {
  return CONTRACT_TIER_ORDER[a.contractTier] - CONTRACT_TIER_ORDER[b.contractTier];
}

function assertSortTicket(ticket: PrioritySortTicket): void {
  if (!ticket || typeof ticket !== 'object' || typeof ticket.ticketId !== 'string' || !ticket.ticketId) {
    throw new RangeError('Ticket ID must be a non-empty string');
  }
  assertContractTier(ticket.contractTier);
  assertCriticalityTier(ticket.criticalityTier);
  if (!Number.isFinite(ticket.timeRemainingHours)) {
    throw new RangeError('Time remaining must be finite');
  }
}

/** Sorts snapshots by the requested raw-tier key chain, then by stable ticket ID. */
export function comparePriorityTickets(view: PriorityView, a: PrioritySortTicket, b: PrioritySortTicket): number {
  if (view !== 'default-focus' && view !== 'criticality-matrix' && view !== 'sla-commitment') {
    throw new RangeError('Unsupported priority view');
  }
  assertSortTicket(a);
  assertSortTicket(b);
  const keys = view === 'default-focus'
    ? [compareRemaining, compareCriticality, compareContract]
    : view === 'criticality-matrix'
      ? [compareCriticality, compareRemaining]
      : [compareContract, compareCriticality, compareRemaining];
  for (const compare of keys) {
    const result = compare(a, b);
    if (result !== 0) return result;
  }
  return compareTicketId(a.ticketId, b.ticketId);
}
