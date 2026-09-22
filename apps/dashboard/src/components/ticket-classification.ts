import type { ContractTier, CriticalityTier, PriorityCategory, PriorityScope, Ticket } from '@luminatick/shared';
import type { TicketClassification } from '../hooks/useTickets';

export type ClassificationDraft = {
  category: PriorityCategory | '';
  scope: PriorityScope | '';
  regulatoryOfficerOnSite: boolean;
  vipBlocked: boolean;
  hardDeadline: boolean;
  contractTier: ContractTier | '';
  criticalityTier: CriticalityTier | null;
};

type ClassificationOption<Value extends string> = { value: Value | ''; label: string };

export const categoryOptions: ClassificationOption<PriorityCategory>[] = [
  { value: '', label: 'Choose category' },
  { value: 'incidents-interruptions', label: 'Incidents and interruptions' },
  { value: 'security-privacy', label: 'Security and privacy' },
  { value: 'access-authentication', label: 'Access and authentication' },
  { value: 'technical-problems', label: 'Technical problems' },
  { value: 'service-requests', label: 'Service requests' },
  { value: 'transactions-billing', label: 'Transactions and billing' },
  { value: 'status-follow-up', label: 'Status and follow-up' },
  { value: 'information-requests', label: 'Information requests' },
  { value: 'how-to-assistance', label: 'How-to assistance' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'other', label: 'Other' },
];
export const scopeOptions: ClassificationOption<PriorityScope>[] = [
  { value: '', label: 'Choose scope' },
  { value: 'systemic', label: 'Systemic' },
  { value: 'localised', label: 'Localised' },
  { value: 'isolated', label: 'Isolated' },
];
export const contractOptions: ClassificationOption<ContractTier>[] = [
  { value: '', label: 'Choose contract tier' },
  { value: 'alpha', label: 'Alpha' },
  { value: 'bravo', label: 'Bravo' },
  { value: 'charlie', label: 'Charlie' },
  { value: 'delta', label: 'Delta' },
];
export const criticalityOptions: ClassificationOption<`${CriticalityTier}`>[] = [
  { value: '', label: 'Choose criticality level' },
  { value: '1', label: 'Level 1' },
  { value: '2', label: 'Level 2' },
  { value: '3', label: 'Level 3' },
  { value: '4', label: 'Level 4' },
];

export function emptyClassificationDraft(): ClassificationDraft {
  return { category: '', scope: '', regulatoryOfficerOnSite: false, vipBlocked: false,
    hardDeadline: false, contractTier: '', criticalityTier: null };
}

export function classificationDraftFromTicket(ticket: Ticket): ClassificationDraft {
  return {
    category: ticket.priority_category ?? '', scope: ticket.priority_scope ?? '',
    regulatoryOfficerOnSite: ticket.priority_regulatory_officer_on_site === 1,
    vipBlocked: ticket.priority_vip_blocked === 1,
    hardDeadline: ticket.priority_hard_deadline === 1,
    contractTier: ticket.contract_sla_tier ?? '', criticalityTier: ticket.criticality_tier ?? null,
  };
}

export function completeClassification(draft: ClassificationDraft): TicketClassification | null {
  if (!draft.category || !draft.scope || !draft.contractTier || draft.criticalityTier === null) return null;
  return { category: draft.category, scope: draft.scope, contractTier: draft.contractTier,
    criticalityTier: draft.criticalityTier, regulatoryOfficerOnSite: draft.regulatoryOfficerOnSite,
    vipBlocked: draft.vipBlocked, hardDeadline: draft.hardDeadline };
}

export function sameClassification(left: ClassificationDraft, right: ClassificationDraft): boolean {
  const first = completeClassification(left);
  const second = completeClassification(right);
  return Boolean(first && second
    && first.category === second.category && first.scope === second.scope
    && first.contractTier === second.contractTier && first.criticalityTier === second.criticalityTier
    && first.regulatoryOfficerOnSite === second.regulatoryOfficerOnSite
    && first.vipBlocked === second.vipBlocked && first.hardDeadline === second.hardDeadline);
}
