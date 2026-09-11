-- Compact tenant accounting prices the retained complete knowledge list
-- without first scanning business rows or imposing a new pagination cap.
CREATE TABLE IF NOT EXISTS knowledge_read_scan_counters (
  tenant_id TEXT PRIMARY KEY,
  document_rows INTEGER NOT NULL DEFAULT 0 CHECK(document_rows >= 0 AND document_rows <= 9007199254740991),
  projection_bytes INTEGER NOT NULL DEFAULT 0 CHECK(projection_bytes >= 0 AND projection_bytes <= 9007199254740991),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0 AND revision <= 9007199254740991)
);

INSERT INTO knowledge_read_scan_counters (tenant_id,document_rows,projection_bytes,revision)
SELECT seed.tenant_id,
  (SELECT count(*) FROM knowledge_docs d WHERE d.tenant_id=seed.tenant_id),
  COALESCE((SELECT sum(
    length(CAST(COALESCE(d.tenant_id,'') AS BLOB))+
    length(CAST(COALESCE(d.id,'') AS BLOB))+
    length(CAST(COALESCE(d.title,'') AS BLOB))+
    length(CAST(COALESCE(d.file_path,'') AS BLOB))+
    length(CAST(COALESCE(d.status,'') AS BLOB))+
    length(CAST(COALESCE(d.category_id,'') AS BLOB))+
    length(CAST(COALESCE(d.tier,'') AS BLOB))+
    length(CAST(COALESCE(d.created_at,'') AS BLOB))+32
  ) FROM knowledge_docs d WHERE d.tenant_id=seed.tenant_id),0),0
FROM (SELECT tenant_id FROM users UNION SELECT tenant_id FROM knowledge_docs) seed
WHERE 1
ON CONFLICT(tenant_id) DO UPDATE SET
  document_rows=excluded.document_rows,
  projection_bytes=excluded.projection_bytes,
  revision=knowledge_read_scan_counters.revision+1;

CREATE TRIGGER IF NOT EXISTS knowledge_read_scan_document_insert
AFTER INSERT ON knowledge_docs BEGIN
  INSERT INTO knowledge_read_scan_counters (tenant_id,document_rows,projection_bytes,revision)
  VALUES (NEW.tenant_id,1,
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.title,'') AS BLOB))+
    length(CAST(COALESCE(NEW.file_path,'') AS BLOB))+
    length(CAST(COALESCE(NEW.status,'') AS BLOB))+
    length(CAST(COALESCE(NEW.category_id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.tier,'') AS BLOB))+
    length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+32,1)
  ON CONFLICT(tenant_id) DO UPDATE SET
    document_rows=document_rows+1,
    projection_bytes=projection_bytes+excluded.projection_bytes,
    revision=revision+1;
END;

CREATE TRIGGER IF NOT EXISTS knowledge_read_scan_document_delete
AFTER DELETE ON knowledge_docs BEGIN
  UPDATE knowledge_read_scan_counters SET
    document_rows=document_rows-1,
    projection_bytes=projection_bytes-(
      length(CAST(COALESCE(OLD.tenant_id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.title,'') AS BLOB))+
      length(CAST(COALESCE(OLD.file_path,'') AS BLOB))+
      length(CAST(COALESCE(OLD.status,'') AS BLOB))+
      length(CAST(COALESCE(OLD.category_id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.tier,'') AS BLOB))+
      length(CAST(COALESCE(OLD.created_at,'') AS BLOB))+32),
    revision=revision+1
  WHERE tenant_id=OLD.tenant_id;
END;

CREATE TRIGGER IF NOT EXISTS knowledge_read_scan_document_update
AFTER UPDATE OF title,file_path,status,category_id,chunk_count,tier,created_at ON knowledge_docs BEGIN
  UPDATE knowledge_read_scan_counters SET projection_bytes=projection_bytes-(
      length(CAST(COALESCE(OLD.tenant_id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.title,'') AS BLOB))+
      length(CAST(COALESCE(OLD.file_path,'') AS BLOB))+
      length(CAST(COALESCE(OLD.status,'') AS BLOB))+
      length(CAST(COALESCE(OLD.category_id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.tier,'') AS BLOB))+
      length(CAST(COALESCE(OLD.created_at,'') AS BLOB))+32)+(
      length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+
      length(CAST(COALESCE(NEW.id,'') AS BLOB))+
      length(CAST(COALESCE(NEW.title,'') AS BLOB))+
      length(CAST(COALESCE(NEW.file_path,'') AS BLOB))+
      length(CAST(COALESCE(NEW.status,'') AS BLOB))+
      length(CAST(COALESCE(NEW.category_id,'') AS BLOB))+
      length(CAST(COALESCE(NEW.tier,'') AS BLOB))+
      length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+32),
    revision=revision+1
  WHERE tenant_id=NEW.tenant_id;
END;

-- Current versioned source metadata is an indexed admission lookup. Historical
-- legacy keys remain readable under the established 10 MiB source allowance.
CREATE INDEX IF NOT EXISTS idx_knowledge_index_versions_document_file
  ON knowledge_index_versions(tenant_id,document_id,file_path);
