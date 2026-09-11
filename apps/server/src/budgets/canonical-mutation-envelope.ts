/**
 * Conservative table/index write slots, not a production billing measurement.
 * One canonical attempt may delete 100 receipts: four indexes and its table
 * row cost at most 500 slots. The original 32 further row mutations plus two
 * public-history projection mutations and 16 recipient activities total 50.
 * Allow table write and removal/insertion for four indexes on each (50 * 9).
 * Two conversation-event rows have a fifth index; reserve four extra slots.
 * Round 954 up to 1,024 per attempt; the isolate receipt allows two attempts.
 * Native D1 schema/metadata tests require review if either inventory grows.
 */
export const CANONICAL_MUTATION_ATTEMPT_D1_WRITES = 1_024;
export const CANONICAL_MUTATION_D1_WRITES = 2 * CANONICAL_MUTATION_ATTEMPT_D1_WRITES;
