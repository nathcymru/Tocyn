/**
 * Conservative table/index write slots, not a production billing measurement.
 * One canonical attempt may delete 100 receipts: four indexes and its table
 * row cost at most 500 slots. The original 32 further row mutations plus two
 * public-history projection mutations and 16 recipient activities total 50.
 * Every non-event row has at most four indexes, so table/index replacement is
 * bounded by 50 * 9 slots. Each of the two conversation-event rows has the
 * existing fifth index plus the two 0045 detail indexes: three indexes above
 * that baseline add 2 rows each on delete/insert (2 * 3 * 2 = 12). The exact
 * inventory is 500 + 450 + 12 = 962, below the 1,024-attempt ceiling.
 * Native D1 schema/metadata tests require review if either inventory grows.
 */
export const CANONICAL_MUTATION_ATTEMPT_D1_WRITES = 1_024;
export const CANONICAL_MUTATION_D1_WRITES = 2 * CANONICAL_MUTATION_ATTEMPT_D1_WRITES;
