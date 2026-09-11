import {
  TICKET_UTILITY_ACTION_VERSION,
  isAllowedTicketUtilityLink,
  type TicketUtilityAction,
  type TicketUtilityActionsV1,
} from '@luminatick/shared';
import type { CapabilityDecision } from '../auth/capability-policy';

const REFERENCE_CAPABILITY = 'tools.reference.read' as const;
const GUIDANCE_HREF = 'https://github.com/nathcymru/Tocyn/blob/main/docs/security/capability-permissions.md';
const DENIED_REASON = 'Reference utilities are not permitted by the current server policy.';

function availability(decision: CapabilityDecision): { enabled: true } | { enabled: false; reason: string } {
  return decision.allowed ? { enabled: true } : { enabled: false, reason: DENIED_REASON };
}

/**
 * Core-owned only: no tenant configuration, scripts, command names, or URL
 * templates enter this registry. A future effect must still authorize and
 * revalidate at its own server dispatch boundary.
 */
export function governedTicketUtilityActions(ticketId: string, decision: CapabilityDecision): TicketUtilityActionsV1 {
  const state = availability(decision);
  const actions: TicketUtilityAction[] = [
    {
      id: 'copy-ticket-reference', label: 'Copy ticket reference', description: 'Copies the current ticket reference.',
      slot: 'action-bar', capability: REFERENCE_CAPABILITY, kind: 'application-command', command: 'copy-ticket-reference', ...state,
    },
    {
      id: 'view-ticket-reference', label: 'View ticket reference', description: 'Shows the current ticket reference in this workspace.',
      slot: 'more', capability: REFERENCE_CAPABILITY, kind: 'internal-dialog', dialog: 'ticket-reference', ...state,
    },
    ...(isAllowedTicketUtilityLink(GUIDANCE_HREF) ? [{
      id: 'open-governed-action-guidance' as const, label: 'Open action safety guidance',
      description: 'Opens the documented action security boundary in a new tab.',
      slot: 'more' as const, capability: REFERENCE_CAPABILITY, kind: 'external-link' as const, href: GUIDANCE_HREF, ...state,
    }] : []),
  ];
  return { version: TICKET_UTILITY_ACTION_VERSION, ticketId, actions };
}
