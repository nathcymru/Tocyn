-- #64 bounded saved-filter administration. The aggregate is maintained with
-- the source table so full tenant lists can reserve their real row population
-- without a pre-admission scan.
CREATE TABLE saved_filter_population (
  tenant_id TEXT PRIMARY KEY,
  filter_rows INTEGER NOT NULL CHECK(filter_rows >= 0),
  condition_bytes INTEGER NOT NULL CHECK(condition_bytes >= 0),
  revision INTEGER NOT NULL CHECK(revision >= 0)
);

INSERT INTO saved_filter_population(tenant_id,filter_rows,condition_bytes,revision)
SELECT tenant_id,count(*),COALESCE(sum(length(CAST(COALESCE(conditions,'') AS BLOB))),0),0
FROM ticket_filters GROUP BY tenant_id
ON CONFLICT(tenant_id) DO UPDATE SET
  filter_rows=excluded.filter_rows,
  condition_bytes=excluded.condition_bytes,
  revision=saved_filter_population.revision+1;

CREATE TRIGGER saved_filter_population_insert AFTER INSERT ON ticket_filters BEGIN
  INSERT INTO saved_filter_population(tenant_id,filter_rows,condition_bytes,revision)
  VALUES(NEW.tenant_id,1,length(CAST(COALESCE(NEW.conditions,'') AS BLOB)),1)
  ON CONFLICT(tenant_id) DO UPDATE SET
    filter_rows=filter_rows+1,
    condition_bytes=condition_bytes+excluded.condition_bytes,
    revision=revision+1;
END;

CREATE TRIGGER saved_filter_population_delete AFTER DELETE ON ticket_filters BEGIN
  UPDATE saved_filter_population SET
    filter_rows=filter_rows-1,
    condition_bytes=condition_bytes-length(CAST(COALESCE(OLD.conditions,'') AS BLOB)),
    revision=revision+1
  WHERE tenant_id=OLD.tenant_id;
END;

CREATE TRIGGER saved_filter_population_update
AFTER UPDATE OF name,conditions,is_system,created_at,updated_at ON ticket_filters BEGIN
  UPDATE saved_filter_population SET
    condition_bytes=condition_bytes-length(CAST(COALESCE(OLD.conditions,'') AS BLOB))+
      length(CAST(COALESCE(NEW.conditions,'') AS BLOB)),
    revision=revision+1
  WHERE tenant_id=NEW.tenant_id;
END;

-- 0053 introduced this counter for ticket-list parsing. Saved-filter reads
-- also need its revision to cover every response-visible field.
DROP TRIGGER IF EXISTS ticket_list_scan_filter_update;
CREATE TRIGGER ticket_list_scan_filter_update
AFTER UPDATE OF name,conditions,is_system,created_at,updated_at ON ticket_filters BEGIN
  UPDATE ticket_list_filter_scan_counters SET
    condition_bytes=length(CAST(COALESCE(NEW.conditions,'') AS BLOB)),
    revision=revision+1
  WHERE tenant_id=NEW.tenant_id AND filter_id=NEW.id;
END;

CREATE TABLE saved_filter_mutation_receipts (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN
    ('dashboard.filter.create','dashboard.filter.update','dashboard.filter.delete')),
  key_hash TEXT NOT NULL CHECK(length(key_hash)=64 AND key_hash NOT GLOB '*[^0-9a-f]*'),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  response_status INTEGER NOT NULL CHECK(response_status IN (200,201)),
  response_snapshot TEXT NOT NULL CHECK(json_valid(response_snapshot)
    AND length(CAST(response_snapshot AS BLOB))<=131072),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch()+86400),
  PRIMARY KEY(tenant_id,principal_id,operation,key_hash)
);
CREATE INDEX idx_saved_filter_receipts_expiry
  ON saved_filter_mutation_receipts(tenant_id,principal_id,expires_at);
CREATE INDEX idx_ticket_filters_tenant_order
  ON ticket_filters(tenant_id,is_system DESC,created_at ASC,id);
