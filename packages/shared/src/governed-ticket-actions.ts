/**
 * The dashboard may only render this finite, server-issued action manifest.
 * It is a presentation contract, never authority to perform an effect.
 */
export const TICKET_UTILITY_ACTION_VERSION = 1 as const;

export type TicketUtilityActionSlot = 'action-bar' | 'more';
export type TicketUtilityActionKind = 'application-command' | 'internal-dialog' | 'external-link';
export type TicketUtilityActionAvailability = Readonly<{ enabled: true } | { enabled: false; reason: string }>;

type TicketUtilityActionBase = Readonly<{
  id: 'copy-ticket-reference' | 'view-ticket-reference' | 'open-governed-action-guidance';
  label: string;
  description: string;
  slot: TicketUtilityActionSlot;
  capability: 'tools.reference.read';
}> & TicketUtilityActionAvailability;

export type TicketUtilityApplicationCommand = TicketUtilityActionBase & Readonly<{
  kind: 'application-command';
  command: 'copy-ticket-reference';
}>;

export type TicketUtilityInternalDialog = TicketUtilityActionBase & Readonly<{
  kind: 'internal-dialog';
  dialog: 'ticket-reference';
}>;

export type TicketUtilityExternalLink = TicketUtilityActionBase & Readonly<{
  kind: 'external-link';
  href: string;
}>;

export type TicketUtilityAction = TicketUtilityApplicationCommand | TicketUtilityInternalDialog | TicketUtilityExternalLink;

export type TicketUtilityActionsV1 = Readonly<{
  version: typeof TICKET_UTILITY_ACTION_VERSION;
  ticketId: string;
  actions: readonly TicketUtilityAction[];
}>;

/** A future integration cannot turn a tenant-provided URL into an action target. */
const ALLOWED_TICKET_UTILITY_LINKS = new Set([
  'https://github.com/nathcymru/Tocyn/blob/main/docs/security/capability-permissions.md',
]);

export function isAllowedTicketUtilityLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === ''
      && !url.search && !url.hash && ALLOWED_TICKET_UTILITY_LINKS.has(url.toString());
  } catch {
    return false;
  }
}
