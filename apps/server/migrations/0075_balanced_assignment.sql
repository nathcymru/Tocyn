-- Explicit #137 routing; operational sequence only, never performance history.
CREATE TABLE tenant_routing_sequence (
 tenant_id TEXT PRIMARY KEY,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE operator_routing_sequence (
 tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(tenant_id,user_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE balanced_assignment_receipts (
 tenant_id TEXT NOT NULL,actor_id TEXT NOT NULL,key_hash TEXT NOT NULL,
 ticket_id TEXT,payload_hash TEXT NOT NULL,
 lifecycle TEXT NOT NULL DEFAULT 'completed' CHECK(lifecycle IN ('completed','gone')),
 outcome TEXT CHECK(outcome IN ('assigned','no_capacity')),
 owner_id TEXT,sequence INTEGER NOT NULL CHECK(sequence BETWEEN 0 AND 9007199254740991),
 created_at TEXT NOT NULL,expires_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,actor_id,key_hash),
 FOREIGN KEY(tenant_id,ticket_id) REFERENCES tickets(tenant_id,id),
 -- actor_id is historical; author deletion must not cascade an unbounded receipt ledger.
 CHECK((lifecycle='gone' AND ticket_id IS NULL AND owner_id IS NULL AND sequence=0 AND outcome IS NULL) OR
   (lifecycle='completed' AND ticket_id IS NOT NULL AND outcome IS NOT NULL AND
    ((outcome='assigned' AND owner_id IS NOT NULL) OR (outcome='no_capacity' AND owner_id IS NULL))))
);
CREATE INDEX idx_balanced_assignment_expiry ON balanced_assignment_receipts(tenant_id,actor_id,expires_at);
CREATE INDEX idx_balanced_assignment_ticket ON balanced_assignment_receipts(tenant_id,ticket_id,lifecycle);
CREATE INDEX idx_operator_capacity_available ON operator_capacity(tenant_id,availability,user_id);
