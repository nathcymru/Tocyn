/** Preserve the confirmed list slot after a server mutation removes a ticket. */
export function deterministicNextTicket<T extends { id: string }>(previous: readonly T[], remaining: readonly T[], ticketId: string): T | undefined {
  if (remaining.length === 0) return undefined;
  const priorIndex = previous.findIndex(ticket => ticket.id === ticketId);
  return remaining[Math.min(Math.max(priorIndex, 0), remaining.length - 1)];
}
