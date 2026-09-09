/** Historical/current records may have no allocated human number; retain their actual ID. */
export function ticketReference(ticket: { id: string; ticket_no?: number | null }, prefix: string): string {
  return typeof ticket.ticket_no === 'number' && Number.isSafeInteger(ticket.ticket_no) && ticket.ticket_no > 0
    ? `${prefix}${ticket.ticket_no}`
    : ticket.id;
}
