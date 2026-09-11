-- Exact tenant-qualified accounting for the retained ticket-list contract.
-- Counters are maintained transactionally with the source rows so an admitted
-- list can fence its count/page snapshot without selecting unbounded article
-- histories before it has reserved capacity.
CREATE TABLE IF NOT EXISTS ticket_list_scan_counters (
  tenant_id TEXT PRIMARY KEY,
  ticket_rows INTEGER NOT NULL DEFAULT 0 CHECK(ticket_rows >= 0),
  ticket_search_bytes INTEGER NOT NULL DEFAULT 0 CHECK(ticket_search_bytes >= 0),
  article_rows INTEGER NOT NULL DEFAULT 0 CHECK(article_rows >= 0),
  article_search_bytes INTEGER NOT NULL DEFAULT 0 CHECK(article_search_bytes >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
);

-- A per-filter row keeps saved-filter parsing request-specific.  It avoids
-- making a tenant's largest historical filter the reservation for every list.
CREATE TABLE IF NOT EXISTS ticket_list_filter_scan_counters (
  tenant_id TEXT NOT NULL,
  filter_id TEXT NOT NULL,
  condition_bytes INTEGER NOT NULL DEFAULT 0 CHECK(condition_bytes >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  PRIMARY KEY (tenant_id, filter_id)
);

-- Idempotent restart-safe backfill.  The tenant source includes empty ticket
-- tenants, so their first admitted list remains available.
INSERT INTO ticket_list_scan_counters
  (tenant_id,ticket_rows,ticket_search_bytes,article_rows,article_search_bytes,revision)
SELECT seed.tenant_id,
  (SELECT count(*) FROM tickets t WHERE t.tenant_id=seed.tenant_id),
  COALESCE((SELECT sum(length(CAST(COALESCE(t.id,'') || COALESCE(t.subject,'') || COALESCE(t.customer_email,'') || COALESCE(CAST(t.ticket_no AS TEXT),'') AS BLOB))) FROM tickets t WHERE t.tenant_id=seed.tenant_id),0),
  (SELECT count(*) FROM articles a WHERE a.tenant_id=seed.tenant_id),
  COALESCE((SELECT sum(length(CAST(COALESCE(a.snippet,'') || COALESCE(a.body,'') AS BLOB))) FROM articles a WHERE a.tenant_id=seed.tenant_id),0),
  0
FROM (
  SELECT tenant_id FROM users
  UNION SELECT tenant_id FROM tickets
  UNION SELECT tenant_id FROM articles
) seed
WHERE 1
ON CONFLICT(tenant_id) DO UPDATE SET
  ticket_rows=excluded.ticket_rows,
  ticket_search_bytes=excluded.ticket_search_bytes,
  article_rows=excluded.article_rows,
  article_search_bytes=excluded.article_search_bytes,
  revision=ticket_list_scan_counters.revision+1;

INSERT INTO ticket_list_filter_scan_counters (tenant_id,filter_id,condition_bytes,revision)
SELECT tenant_id,id,length(CAST(conditions AS BLOB)),0 FROM ticket_filters WHERE 1
ON CONFLICT(tenant_id,filter_id) DO UPDATE SET
  condition_bytes=excluded.condition_bytes,
  revision=ticket_list_filter_scan_counters.revision+1;

CREATE TRIGGER IF NOT EXISTS ticket_list_scan_ticket_insert
AFTER INSERT ON tickets BEGIN
  INSERT INTO ticket_list_scan_counters
    (tenant_id,ticket_rows,ticket_search_bytes,article_rows,article_search_bytes,revision)
  VALUES (NEW.tenant_id,1,length(CAST(COALESCE(NEW.id,'') || COALESCE(NEW.subject,'') || COALESCE(NEW.customer_email,'') || COALESCE(CAST(NEW.ticket_no AS TEXT),'') AS BLOB)),0,0,1)
  ON CONFLICT(tenant_id) DO UPDATE SET ticket_rows=ticket_rows+1,
    ticket_search_bytes=ticket_search_bytes+excluded.ticket_search_bytes,revision=revision+1;
END;

CREATE TRIGGER IF NOT EXISTS ticket_list_scan_ticket_delete
AFTER DELETE ON tickets BEGIN
  UPDATE ticket_list_scan_counters SET ticket_rows=ticket_rows-1,
    ticket_search_bytes=ticket_search_bytes-length(CAST(COALESCE(OLD.id,'') || COALESCE(OLD.subject,'') || COALESCE(OLD.customer_email,'') || COALESCE(CAST(OLD.ticket_no AS TEXT),'') AS BLOB)),revision=revision+1
  WHERE tenant_id=OLD.tenant_id;
END;

CREATE TRIGGER IF NOT EXISTS ticket_list_scan_ticket_update
AFTER UPDATE OF id,subject,customer_email,ticket_no ON tickets BEGIN
  UPDATE ticket_list_scan_counters SET
    ticket_search_bytes=ticket_search_bytes-length(CAST(COALESCE(OLD.id,'') || COALESCE(OLD.subject,'') || COALESCE(OLD.customer_email,'') || COALESCE(CAST(OLD.ticket_no AS TEXT),'') AS BLOB))+
      length(CAST(COALESCE(NEW.id,'') || COALESCE(NEW.subject,'') || COALESCE(NEW.customer_email,'') || COALESCE(CAST(NEW.ticket_no AS TEXT),'') AS BLOB)),revision=revision+1
  WHERE tenant_id=NEW.tenant_id;
END;

CREATE TRIGGER IF NOT EXISTS ticket_list_scan_article_insert
AFTER INSERT ON articles BEGIN
  INSERT INTO ticket_list_scan_counters
    (tenant_id,ticket_rows,ticket_search_bytes,article_rows,article_search_bytes,revision)
  VALUES (NEW.tenant_id,0,0,1,length(CAST(COALESCE(NEW.snippet,'') || COALESCE(NEW.body,'') AS BLOB)),1)
  ON CONFLICT(tenant_id) DO UPDATE SET article_rows=article_rows+1,
    article_search_bytes=article_search_bytes+excluded.article_search_bytes,revision=revision+1;
END;

CREATE TRIGGER IF NOT EXISTS ticket_list_scan_article_delete
AFTER DELETE ON articles BEGIN
  UPDATE ticket_list_scan_counters SET article_rows=article_rows-1,
    article_search_bytes=article_search_bytes-length(CAST(COALESCE(OLD.snippet,'') || COALESCE(OLD.body,'') AS BLOB)),revision=revision+1
  WHERE tenant_id=OLD.tenant_id;
END;

CREATE TRIGGER IF NOT EXISTS ticket_list_scan_article_update
AFTER UPDATE OF snippet,body ON articles BEGIN
  UPDATE ticket_list_scan_counters SET
    article_search_bytes=article_search_bytes-length(CAST(COALESCE(OLD.snippet,'') || COALESCE(OLD.body,'') AS BLOB))+
      length(CAST(COALESCE(NEW.snippet,'') || COALESCE(NEW.body,'') AS BLOB)),revision=revision+1
  WHERE tenant_id=NEW.tenant_id;
END;

CREATE TRIGGER IF NOT EXISTS ticket_list_scan_filter_insert
AFTER INSERT ON ticket_filters BEGIN
  INSERT INTO ticket_list_filter_scan_counters (tenant_id,filter_id,condition_bytes,revision)
  VALUES (NEW.tenant_id,NEW.id,length(CAST(NEW.conditions AS BLOB)),1)
  ON CONFLICT(tenant_id,filter_id) DO UPDATE SET condition_bytes=excluded.condition_bytes,revision=revision+1;
END;

CREATE TRIGGER IF NOT EXISTS ticket_list_scan_filter_update
AFTER UPDATE OF conditions ON ticket_filters BEGIN
  UPDATE ticket_list_filter_scan_counters SET condition_bytes=length(CAST(NEW.conditions AS BLOB)),revision=revision+1
  WHERE tenant_id=NEW.tenant_id AND filter_id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS ticket_list_scan_filter_delete
AFTER DELETE ON ticket_filters BEGIN
  DELETE FROM ticket_list_filter_scan_counters WHERE tenant_id=OLD.tenant_id AND filter_id=OLD.id;
END;

-- The retained page/total API still accepts page numbers.  These indexes make
-- its two chronological orders index-backed while the metadata reservation
-- covers the retained full candidate count/search work.
CREATE INDEX IF NOT EXISTS idx_tickets_list_tenant_updated_id
  ON tickets(tenant_id,updated_at DESC,id);
CREATE INDEX IF NOT EXISTS idx_tickets_list_tenant_created_id
  ON tickets(tenant_id,created_at DESC,id);
