/**
 * Conservative table/index write slots, not a production billing measurement.
 * One canonical attempt may delete 100 receipts; each has four indexes plus
 * its table row (500 slots). At most 32 further row mutations cover ticket,
 * article, ten attachments, audit, SLA, assertion/local-beta and support-state
 * defaults. Their current tables have at most four indexes: allow the table
 * write plus removal/insertion of every index entry (32 * 9 = 288 slots).
 * Round 788 up to 1,024 per attempt; the isolate receipt allows two attempts.
 * Native D1 schema/metadata tests require review if either inventory grows.
 */
export const CANONICAL_MUTATION_ATTEMPT_D1_WRITES = 1_024;
export const CANONICAL_MUTATION_D1_WRITES = 2 * CANONICAL_MUTATION_ATTEMPT_D1_WRITES;
