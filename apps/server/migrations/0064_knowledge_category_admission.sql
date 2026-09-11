-- Complete category-list accounting. The counter is maintained without loading
-- retained category names before admission and keeps the empty-tenant response valid.
CREATE TABLE IF NOT EXISTS knowledge_category_population (
  tenant_id TEXT PRIMARY KEY,
  category_rows INTEGER NOT NULL DEFAULT 0 CHECK(category_rows >= 0 AND category_rows <= 9007199254740991),
  projection_bytes INTEGER NOT NULL DEFAULT 0 CHECK(projection_bytes >= 0 AND projection_bytes <= 9007199254740991),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0 AND revision <= 9007199254740991)
);

INSERT INTO knowledge_category_population (tenant_id,category_rows,projection_bytes,revision)
SELECT seed.tenant_id,
  (SELECT count(*) FROM knowledge_categories c WHERE c.tenant_id=seed.tenant_id),
  COALESCE((SELECT sum(
    length(CAST(COALESCE(c.tenant_id,'') AS BLOB))+
    length(CAST(COALESCE(c.id,'') AS BLOB))+
    length(CAST(COALESCE(c.name,'') AS BLOB))+
    length(CAST(COALESCE(c.parent_id,'') AS BLOB))+
    length(CAST(COALESCE(c.created_at,'') AS BLOB))+24
  ) FROM knowledge_categories c WHERE c.tenant_id=seed.tenant_id),0),0
FROM (SELECT tenant_id FROM users UNION SELECT tenant_id FROM knowledge_categories) seed
WHERE 1
ON CONFLICT(tenant_id) DO UPDATE SET
  category_rows=excluded.category_rows,
  projection_bytes=excluded.projection_bytes,
  revision=knowledge_category_population.revision+1;

CREATE TRIGGER IF NOT EXISTS knowledge_category_population_user_insert
AFTER INSERT ON users BEGIN
  INSERT INTO knowledge_category_population(tenant_id,category_rows,projection_bytes,revision)
  VALUES(NEW.tenant_id,0,0,0) ON CONFLICT(tenant_id) DO NOTHING;
END;

CREATE TRIGGER IF NOT EXISTS knowledge_category_population_insert
AFTER INSERT ON knowledge_categories BEGIN
  INSERT INTO knowledge_category_population(tenant_id,category_rows,projection_bytes,revision)
  VALUES(NEW.tenant_id,1,
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+
    length(CAST(COALESCE(NEW.parent_id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+24,1)
  ON CONFLICT(tenant_id) DO UPDATE SET
    category_rows=category_rows+1,
    projection_bytes=projection_bytes+excluded.projection_bytes,
    revision=revision+1;
END;

CREATE TRIGGER IF NOT EXISTS knowledge_category_population_delete
AFTER DELETE ON knowledge_categories BEGIN
  UPDATE knowledge_category_population SET
    category_rows=category_rows-1,
    projection_bytes=projection_bytes-(
      length(CAST(COALESCE(OLD.tenant_id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.name,'') AS BLOB))+
      length(CAST(COALESCE(OLD.parent_id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.created_at,'') AS BLOB))+24),
    revision=revision+1
  WHERE tenant_id=OLD.tenant_id;
END;

CREATE TRIGGER IF NOT EXISTS knowledge_category_population_update
AFTER UPDATE OF name,parent_id,created_at ON knowledge_categories BEGIN
  UPDATE knowledge_category_population SET projection_bytes=projection_bytes-(
      length(CAST(COALESCE(OLD.tenant_id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.name,'') AS BLOB))+
      length(CAST(COALESCE(OLD.parent_id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.created_at,'') AS BLOB))+24)+(
      length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+
      length(CAST(COALESCE(NEW.id,'') AS BLOB))+
      length(CAST(COALESCE(NEW.name,'') AS BLOB))+
      length(CAST(COALESCE(NEW.parent_id,'') AS BLOB))+
      length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+24),
    revision=revision+1
  WHERE tenant_id=NEW.tenant_id;
END;

CREATE TABLE IF NOT EXISTS knowledge_category_mutation_receipts (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('knowledge.category.create','knowledge.category.delete')),
  key_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL DEFAULT 200 CHECK(response_status=200),
  response_snapshot TEXT NOT NULL CHECK(length(CAST(response_snapshot AS BLOB)) <= 2048),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch()+86400),
  PRIMARY KEY(tenant_id,principal_id,operation,key_hash)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_category_receipts_expiry
  ON knowledge_category_mutation_receipts(tenant_id,principal_id,expires_at);

CREATE INDEX IF NOT EXISTS idx_knowledge_categories_tenant_created
  ON knowledge_categories(tenant_id,created_at,id);
