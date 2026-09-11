-- Authentication effects need a fail-closed assertion that is independent of
-- canonical ticket mutations.  Unlike budget_mutation_assertion, zero is a
-- valid outcome here: a stale admission must leave the guarded write absent.
CREATE TABLE IF NOT EXISTS customer_auth_budget_assertions (
  tenant_id TEXT PRIMARY KEY,
  accepted INTEGER NOT NULL CHECK (accepted IN (0,1))
);
