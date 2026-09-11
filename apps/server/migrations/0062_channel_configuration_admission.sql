-- #64 bounded support-email configuration admission. Counters are maintained
-- with source rows so list and default-switch work can be reserved without a
-- pre-admission content scan or a tenant channel-count ceiling.
CREATE TABLE channel_configuration_population (
  tenant_id TEXT PRIMARY KEY,
  row_count INTEGER NOT NULL CHECK(row_count >= 0),
  default_rows INTEGER NOT NULL CHECK(default_rows >= 0 AND default_rows <= row_count),
  content_bytes INTEGER NOT NULL CHECK(content_bytes >= 0),
  revision INTEGER NOT NULL CHECK(revision >= 0)
);

CREATE TABLE support_email_admission_targets (
  tenant_id TEXT NOT NULL,
  email_id TEXT NOT NULL,
  content_bytes INTEGER NOT NULL CHECK(content_bytes >= 0),
  revision INTEGER NOT NULL CHECK(revision >= 0),
  PRIMARY KEY(tenant_id,email_id)
);

INSERT INTO channel_configuration_population(tenant_id,row_count,default_rows,content_bytes,revision)
SELECT tenant_id,count(*),sum(CASE WHEN is_default<>0 THEN 1 ELSE 0 END),COALESCE(sum(
  length(CAST(COALESCE(tenant_id,'') AS BLOB))+length(CAST(COALESCE(id,'') AS BLOB))+
  length(CAST(COALESCE(email_address,'') AS BLOB))+length(CAST(COALESCE(normalized_email,'') AS BLOB))+
  length(CAST(COALESCE(name,'') AS BLOB))+length(CAST(COALESCE(group_id,'') AS BLOB))+
  length(CAST(COALESCE(created_at,'') AS BLOB))+length(CAST(COALESCE(updated_at,'') AS BLOB))+
  length(CAST(COALESCE(CAST(is_default AS TEXT),'') AS BLOB))),0),0
FROM support_emails GROUP BY tenant_id;

INSERT INTO support_email_admission_targets(tenant_id,email_id,content_bytes,revision)
SELECT tenant_id,id,
  length(CAST(COALESCE(tenant_id,'') AS BLOB))+length(CAST(COALESCE(id,'') AS BLOB))+
  length(CAST(COALESCE(email_address,'') AS BLOB))+length(CAST(COALESCE(normalized_email,'') AS BLOB))+
  length(CAST(COALESCE(name,'') AS BLOB))+length(CAST(COALESCE(group_id,'') AS BLOB))+
  length(CAST(COALESCE(created_at,'') AS BLOB))+length(CAST(COALESCE(updated_at,'') AS BLOB))+
  length(CAST(COALESCE(CAST(is_default AS TEXT),'') AS BLOB)),0 FROM support_emails;

CREATE TRIGGER channel_configuration_insert AFTER INSERT ON support_emails BEGIN
  INSERT INTO channel_configuration_population(tenant_id,row_count,default_rows,content_bytes,revision)
  VALUES(NEW.tenant_id,1,CASE WHEN NEW.is_default<>0 THEN 1 ELSE 0 END,
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.email_address,'') AS BLOB))+length(CAST(COALESCE(NEW.normalized_email,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.group_id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+length(CAST(COALESCE(NEW.updated_at,'') AS BLOB))+
    length(CAST(COALESCE(CAST(NEW.is_default AS TEXT),'') AS BLOB)),1)
  ON CONFLICT(tenant_id) DO UPDATE SET row_count=row_count+1,default_rows=default_rows+excluded.default_rows,
    content_bytes=content_bytes+excluded.content_bytes,revision=revision+1;
  INSERT INTO support_email_admission_targets(tenant_id,email_id,content_bytes,revision)
  VALUES(NEW.tenant_id,NEW.id,
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.email_address,'') AS BLOB))+length(CAST(COALESCE(NEW.normalized_email,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.group_id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+length(CAST(COALESCE(NEW.updated_at,'') AS BLOB))+
    length(CAST(COALESCE(CAST(NEW.is_default AS TEXT),'') AS BLOB)),1);
END;

CREATE TRIGGER channel_configuration_delete AFTER DELETE ON support_emails BEGIN
  UPDATE channel_configuration_population SET row_count=row_count-1,
    default_rows=default_rows-CASE WHEN OLD.is_default<>0 THEN 1 ELSE 0 END,
    content_bytes=content_bytes-(
      length(CAST(COALESCE(OLD.tenant_id,'') AS BLOB))+length(CAST(COALESCE(OLD.id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.email_address,'') AS BLOB))+length(CAST(COALESCE(OLD.normalized_email,'') AS BLOB))+
      length(CAST(COALESCE(OLD.name,'') AS BLOB))+length(CAST(COALESCE(OLD.group_id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.created_at,'') AS BLOB))+length(CAST(COALESCE(OLD.updated_at,'') AS BLOB))+
      length(CAST(COALESCE(CAST(OLD.is_default AS TEXT),'') AS BLOB))),revision=revision+1
  WHERE tenant_id=OLD.tenant_id;
  DELETE FROM support_email_admission_targets WHERE tenant_id=OLD.tenant_id AND email_id=OLD.id;
END;

CREATE TRIGGER channel_configuration_update_same
AFTER UPDATE OF id,email_address,normalized_email,name,group_id,is_default,created_at,updated_at ON support_emails
WHEN OLD.tenant_id=NEW.tenant_id BEGIN
  UPDATE channel_configuration_population SET
    default_rows=default_rows-CASE WHEN OLD.is_default<>0 THEN 1 ELSE 0 END+CASE WHEN NEW.is_default<>0 THEN 1 ELSE 0 END,
    content_bytes=content_bytes-(
      length(CAST(COALESCE(OLD.tenant_id,'') AS BLOB))+length(CAST(COALESCE(OLD.id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.email_address,'') AS BLOB))+length(CAST(COALESCE(OLD.normalized_email,'') AS BLOB))+
      length(CAST(COALESCE(OLD.name,'') AS BLOB))+length(CAST(COALESCE(OLD.group_id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.created_at,'') AS BLOB))+length(CAST(COALESCE(OLD.updated_at,'') AS BLOB))+
      length(CAST(COALESCE(CAST(OLD.is_default AS TEXT),'') AS BLOB)))+(
      length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
      length(CAST(COALESCE(NEW.email_address,'') AS BLOB))+length(CAST(COALESCE(NEW.normalized_email,'') AS BLOB))+
      length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.group_id,'') AS BLOB))+
      length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+length(CAST(COALESCE(NEW.updated_at,'') AS BLOB))+
      length(CAST(COALESCE(CAST(NEW.is_default AS TEXT),'') AS BLOB))),revision=revision+1
  WHERE tenant_id=NEW.tenant_id;
  UPDATE support_email_admission_targets SET email_id=NEW.id,content_bytes=
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.email_address,'') AS BLOB))+length(CAST(COALESCE(NEW.normalized_email,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.group_id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+length(CAST(COALESCE(NEW.updated_at,'') AS BLOB))+
    length(CAST(COALESCE(CAST(NEW.is_default AS TEXT),'') AS BLOB)),revision=revision+1
  WHERE tenant_id=NEW.tenant_id AND email_id=OLD.id;
END;

CREATE TRIGGER channel_configuration_update_tenant AFTER UPDATE OF tenant_id ON support_emails
WHEN OLD.tenant_id<>NEW.tenant_id BEGIN
  UPDATE channel_configuration_population SET row_count=row_count-1,
    default_rows=default_rows-CASE WHEN OLD.is_default<>0 THEN 1 ELSE 0 END,
    content_bytes=content_bytes-(
      length(CAST(COALESCE(OLD.tenant_id,'') AS BLOB))+length(CAST(COALESCE(OLD.id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.email_address,'') AS BLOB))+length(CAST(COALESCE(OLD.normalized_email,'') AS BLOB))+
      length(CAST(COALESCE(OLD.name,'') AS BLOB))+length(CAST(COALESCE(OLD.group_id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.created_at,'') AS BLOB))+length(CAST(COALESCE(OLD.updated_at,'') AS BLOB))+
      length(CAST(COALESCE(CAST(OLD.is_default AS TEXT),'') AS BLOB))),revision=revision+1 WHERE tenant_id=OLD.tenant_id;
  INSERT INTO channel_configuration_population(tenant_id,row_count,default_rows,content_bytes,revision)
  VALUES(NEW.tenant_id,1,CASE WHEN NEW.is_default<>0 THEN 1 ELSE 0 END,
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.email_address,'') AS BLOB))+length(CAST(COALESCE(NEW.normalized_email,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.group_id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+length(CAST(COALESCE(NEW.updated_at,'') AS BLOB))+
    length(CAST(COALESCE(CAST(NEW.is_default AS TEXT),'') AS BLOB)),1)
  ON CONFLICT(tenant_id) DO UPDATE SET row_count=row_count+1,default_rows=default_rows+excluded.default_rows,
    content_bytes=content_bytes+excluded.content_bytes,revision=revision+1;
  DELETE FROM support_email_admission_targets WHERE tenant_id=OLD.tenant_id AND email_id=OLD.id;
  INSERT INTO support_email_admission_targets(tenant_id,email_id,content_bytes,revision)
  VALUES(NEW.tenant_id,NEW.id,
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.email_address,'') AS BLOB))+length(CAST(COALESCE(NEW.normalized_email,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.group_id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+length(CAST(COALESCE(NEW.updated_at,'') AS BLOB))+
    length(CAST(COALESCE(CAST(NEW.is_default AS TEXT),'') AS BLOB)),1);
END;

CREATE TABLE channel_configuration_mutation_receipts (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('dashboard.channel.email.create','dashboard.channel.email.delete')),
  key_hash TEXT NOT NULL CHECK(length(key_hash)=64 AND key_hash NOT GLOB '*[^0-9a-f]*'),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  response_status INTEGER NOT NULL CHECK(response_status IN (200,201)),
  response_bytes INTEGER NOT NULL CHECK(response_bytes >= 0 AND response_bytes=length(CAST(response_snapshot AS BLOB))),
  reserved_d1_rows_read INTEGER NOT NULL CHECK(reserved_d1_rows_read >= 4096),
  reserved_d1_rows_written INTEGER NOT NULL CHECK(reserved_d1_rows_written >= 16),
  response_snapshot TEXT NOT NULL CHECK(json_valid(response_snapshot)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch()+86400),
  PRIMARY KEY(tenant_id,principal_id,operation,key_hash)
);
CREATE INDEX idx_channel_configuration_receipts_expiry
  ON channel_configuration_mutation_receipts(tenant_id,principal_id,expires_at);
CREATE INDEX idx_support_emails_tenant_list
  ON support_emails(tenant_id,created_at ASC,id);
