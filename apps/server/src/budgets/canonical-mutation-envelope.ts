/**
 * Conservative table/index write slots, not a production billing measurement.
 * An attempt may delete 100 receipts (table plus four indexes): 500 slots.
 * The retained bound for other row mutations is 50: the original 32 plus two
 * public-history projection mutations and at most 16 recipient activities.
 * Charging each of those at one table write plus replacement of four indexes
 * gives 50 * 9 = 450 slots. Exact exceptions above four indexes are:
 * - two conversation-event mutations, seven indexes: 2 * (7-4) * 2 = 12;
 * - one ticket mutation, eight indexes: (8-4) * 2 = 8;
 * - two article mutations, five indexes: 2 * (5-4) * 2 = 4;
 * - one support-state mutation, five indexes: (5-4) * 2 = 2.
 * Ticket create/touch/audited update are exclusive. An update can emit the
 * combined system note and custom-field note; intake/reply inserts one article.
 * Support state is initialized/synchronized by 0030 or resurfaced by a customer
 * reply. An override changes its one assignment event; that path cannot also
 * update status, so the two-event-mutation maximum still holds.
 * Total: 500 + 450 + 12 + 8 + 4 + 2 = 976, below 1,024 per attempt.
 * Native schema/metadata tests require review when inventory or bounds change.
 * This write-slot bound does not establish ticket/index storage-stock admission.
 */
export const CANONICAL_MUTATION_ATTEMPT_D1_WRITES = 1_024;
export const CANONICAL_MUTATION_D1_WRITES = 2 * CANONICAL_MUTATION_ATTEMPT_D1_WRITES;
