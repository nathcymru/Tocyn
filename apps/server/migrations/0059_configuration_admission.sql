-- #64 bounded ticket-field and automation configuration admission. These
-- aggregates track every response-visible byte without loading configuration
-- bodies before the request has reserved its D1 work.
CREATE TABLE configuration_admission_population (
  tenant_id TEXT NOT NULL,
  family TEXT NOT NULL CHECK(family IN ('ticket-field','automation')),
  row_count INTEGER NOT NULL CHECK(row_count >= 0),
  content_bytes INTEGER NOT NULL CHECK(content_bytes >= 0),
  revision INTEGER NOT NULL CHECK(revision >= 0),
  PRIMARY KEY(tenant_id,family)
);

CREATE TABLE automation_admission_targets (
  tenant_id TEXT NOT NULL,
  automation_id TEXT NOT NULL,
  content_bytes INTEGER NOT NULL CHECK(content_bytes >= 0),
  revision INTEGER NOT NULL CHECK(revision >= 0),
  PRIMARY KEY(tenant_id,automation_id)
);

INSERT INTO configuration_admission_population(tenant_id,family,row_count,content_bytes,revision)
SELECT tenant_id,'ticket-field',count(*),COALESCE(sum(
  length(CAST(COALESCE(tenant_id,'') AS BLOB))+length(CAST(COALESCE(id,'') AS BLOB))+
  length(CAST(COALESCE(name,'') AS BLOB))+length(CAST(COALESCE(label,'') AS BLOB))+
  length(CAST(COALESCE(field_type,'') AS BLOB))+length(CAST(COALESCE(options,'') AS BLOB))+
  length(CAST(COALESCE(CAST(is_active AS TEXT),'') AS BLOB))),0),0
FROM ticket_fields GROUP BY tenant_id;

INSERT INTO configuration_admission_population(tenant_id,family,row_count,content_bytes,revision)
SELECT tenant_id,'automation',count(*),COALESCE(sum(
  length(CAST(COALESCE(tenant_id,'') AS BLOB))+length(CAST(COALESCE(id,'') AS BLOB))+
  length(CAST(COALESCE(name,'') AS BLOB))+length(CAST(COALESCE(event_type,'') AS BLOB))+
  length(CAST(COALESCE(conditions,'') AS BLOB))+length(CAST(COALESCE(action_type,'') AS BLOB))+
  length(CAST(COALESCE(action_config,'') AS BLOB))+length(CAST(COALESCE(created_at,'') AS BLOB))+
  length(CAST(COALESCE(CAST(is_active AS TEXT),'') AS BLOB))),0),0
FROM automation_rules GROUP BY tenant_id;

INSERT INTO automation_admission_targets(tenant_id,automation_id,content_bytes,revision)
SELECT tenant_id,id,
  length(CAST(COALESCE(tenant_id,'') AS BLOB))+length(CAST(COALESCE(id,'') AS BLOB))+
  length(CAST(COALESCE(name,'') AS BLOB))+length(CAST(COALESCE(event_type,'') AS BLOB))+
  length(CAST(COALESCE(conditions,'') AS BLOB))+length(CAST(COALESCE(action_type,'') AS BLOB))+
  length(CAST(COALESCE(action_config,'') AS BLOB))+length(CAST(COALESCE(created_at,'') AS BLOB))+
  length(CAST(COALESCE(CAST(is_active AS TEXT),'') AS BLOB)),0
FROM automation_rules;

CREATE TRIGGER configuration_ticket_field_insert AFTER INSERT ON ticket_fields BEGIN
  INSERT INTO configuration_admission_population(tenant_id,family,row_count,content_bytes,revision)
  VALUES(NEW.tenant_id,'ticket-field',1,
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.label,'') AS BLOB))+
    length(CAST(COALESCE(NEW.field_type,'') AS BLOB))+length(CAST(COALESCE(NEW.options,'') AS BLOB))+
    length(CAST(COALESCE(CAST(NEW.is_active AS TEXT),'') AS BLOB)),1)
  ON CONFLICT(tenant_id,family) DO UPDATE SET row_count=row_count+1,
    content_bytes=content_bytes+excluded.content_bytes,revision=revision+1;
END;

CREATE TRIGGER configuration_ticket_field_delete AFTER DELETE ON ticket_fields BEGIN
  UPDATE configuration_admission_population SET row_count=row_count-1,
    content_bytes=content_bytes-(
      length(CAST(COALESCE(OLD.tenant_id,'') AS BLOB))+length(CAST(COALESCE(OLD.id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.name,'') AS BLOB))+length(CAST(COALESCE(OLD.label,'') AS BLOB))+
      length(CAST(COALESCE(OLD.field_type,'') AS BLOB))+length(CAST(COALESCE(OLD.options,'') AS BLOB))+
      length(CAST(COALESCE(CAST(OLD.is_active AS TEXT),'') AS BLOB))),
    revision=revision+1 WHERE tenant_id=OLD.tenant_id AND family='ticket-field';
END;

CREATE TRIGGER configuration_ticket_field_update_same AFTER UPDATE OF id,name,label,field_type,options,is_active ON ticket_fields
WHEN OLD.tenant_id=NEW.tenant_id BEGIN
  UPDATE configuration_admission_population SET content_bytes=content_bytes-(
    length(CAST(COALESCE(OLD.tenant_id,'') AS BLOB))+length(CAST(COALESCE(OLD.id,'') AS BLOB))+
    length(CAST(COALESCE(OLD.name,'') AS BLOB))+length(CAST(COALESCE(OLD.label,'') AS BLOB))+
    length(CAST(COALESCE(OLD.field_type,'') AS BLOB))+length(CAST(COALESCE(OLD.options,'') AS BLOB))+
    length(CAST(COALESCE(CAST(OLD.is_active AS TEXT),'') AS BLOB)))+(
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.label,'') AS BLOB))+
    length(CAST(COALESCE(NEW.field_type,'') AS BLOB))+length(CAST(COALESCE(NEW.options,'') AS BLOB))+
    length(CAST(COALESCE(CAST(NEW.is_active AS TEXT),'') AS BLOB))),
    revision=revision+1 WHERE tenant_id=NEW.tenant_id AND family='ticket-field';
END;

CREATE TRIGGER configuration_ticket_field_update_tenant AFTER UPDATE OF tenant_id ON ticket_fields
WHEN OLD.tenant_id<>NEW.tenant_id BEGIN
  UPDATE configuration_admission_population SET row_count=row_count-1,
    content_bytes=content_bytes-(
      length(CAST(COALESCE(OLD.tenant_id,'') AS BLOB))+length(CAST(COALESCE(OLD.id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.name,'') AS BLOB))+length(CAST(COALESCE(OLD.label,'') AS BLOB))+
      length(CAST(COALESCE(OLD.field_type,'') AS BLOB))+length(CAST(COALESCE(OLD.options,'') AS BLOB))+
      length(CAST(COALESCE(CAST(OLD.is_active AS TEXT),'') AS BLOB))),
    revision=revision+1 WHERE tenant_id=OLD.tenant_id AND family='ticket-field';
  INSERT INTO configuration_admission_population(tenant_id,family,row_count,content_bytes,revision)
  VALUES(NEW.tenant_id,'ticket-field',1,
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.label,'') AS BLOB))+
    length(CAST(COALESCE(NEW.field_type,'') AS BLOB))+length(CAST(COALESCE(NEW.options,'') AS BLOB))+
    length(CAST(COALESCE(CAST(NEW.is_active AS TEXT),'') AS BLOB)),1)
  ON CONFLICT(tenant_id,family) DO UPDATE SET row_count=row_count+1,
    content_bytes=content_bytes+excluded.content_bytes,revision=revision+1;
END;

CREATE TRIGGER configuration_automation_insert AFTER INSERT ON automation_rules BEGIN
  INSERT INTO configuration_admission_population(tenant_id,family,row_count,content_bytes,revision)
  VALUES(NEW.tenant_id,'automation',1,
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.event_type,'') AS BLOB))+
    length(CAST(COALESCE(NEW.conditions,'') AS BLOB))+length(CAST(COALESCE(NEW.action_type,'') AS BLOB))+
    length(CAST(COALESCE(NEW.action_config,'') AS BLOB))+length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+
    length(CAST(COALESCE(CAST(NEW.is_active AS TEXT),'') AS BLOB)),1)
  ON CONFLICT(tenant_id,family) DO UPDATE SET row_count=row_count+1,
    content_bytes=content_bytes+excluded.content_bytes,revision=revision+1;
  INSERT INTO automation_admission_targets(tenant_id,automation_id,content_bytes,revision)
  VALUES(NEW.tenant_id,NEW.id,
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.event_type,'') AS BLOB))+
    length(CAST(COALESCE(NEW.conditions,'') AS BLOB))+length(CAST(COALESCE(NEW.action_type,'') AS BLOB))+
    length(CAST(COALESCE(NEW.action_config,'') AS BLOB))+length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+
    length(CAST(COALESCE(CAST(NEW.is_active AS TEXT),'') AS BLOB)),1);
END;

CREATE TRIGGER configuration_automation_delete AFTER DELETE ON automation_rules BEGIN
  UPDATE configuration_admission_population SET row_count=row_count-1,
    content_bytes=content_bytes-(
      length(CAST(COALESCE(OLD.tenant_id,'') AS BLOB))+length(CAST(COALESCE(OLD.id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.name,'') AS BLOB))+length(CAST(COALESCE(OLD.event_type,'') AS BLOB))+
      length(CAST(COALESCE(OLD.conditions,'') AS BLOB))+length(CAST(COALESCE(OLD.action_type,'') AS BLOB))+
      length(CAST(COALESCE(OLD.action_config,'') AS BLOB))+length(CAST(COALESCE(OLD.created_at,'') AS BLOB))+
      length(CAST(COALESCE(CAST(OLD.is_active AS TEXT),'') AS BLOB))),
    revision=revision+1 WHERE tenant_id=OLD.tenant_id AND family='automation';
  DELETE FROM automation_admission_targets WHERE tenant_id=OLD.tenant_id AND automation_id=OLD.id;
END;

CREATE TRIGGER configuration_automation_update_same
AFTER UPDATE OF id,name,event_type,conditions,action_type,action_config,is_active,created_at ON automation_rules
WHEN OLD.tenant_id=NEW.tenant_id BEGIN
  UPDATE configuration_admission_population SET content_bytes=content_bytes-(
    length(CAST(COALESCE(OLD.tenant_id,'') AS BLOB))+length(CAST(COALESCE(OLD.id,'') AS BLOB))+
    length(CAST(COALESCE(OLD.name,'') AS BLOB))+length(CAST(COALESCE(OLD.event_type,'') AS BLOB))+
    length(CAST(COALESCE(OLD.conditions,'') AS BLOB))+length(CAST(COALESCE(OLD.action_type,'') AS BLOB))+
    length(CAST(COALESCE(OLD.action_config,'') AS BLOB))+length(CAST(COALESCE(OLD.created_at,'') AS BLOB))+
    length(CAST(COALESCE(CAST(OLD.is_active AS TEXT),'') AS BLOB)))+(
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.event_type,'') AS BLOB))+
    length(CAST(COALESCE(NEW.conditions,'') AS BLOB))+length(CAST(COALESCE(NEW.action_type,'') AS BLOB))+
    length(CAST(COALESCE(NEW.action_config,'') AS BLOB))+length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+
    length(CAST(COALESCE(CAST(NEW.is_active AS TEXT),'') AS BLOB))),
    revision=revision+1 WHERE tenant_id=NEW.tenant_id AND family='automation';
  UPDATE automation_admission_targets SET automation_id=NEW.id,content_bytes=
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.event_type,'') AS BLOB))+
    length(CAST(COALESCE(NEW.conditions,'') AS BLOB))+length(CAST(COALESCE(NEW.action_type,'') AS BLOB))+
    length(CAST(COALESCE(NEW.action_config,'') AS BLOB))+length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+
    length(CAST(COALESCE(CAST(NEW.is_active AS TEXT),'') AS BLOB)),
    revision=revision+1 WHERE tenant_id=NEW.tenant_id AND automation_id=OLD.id;
END;

CREATE TRIGGER configuration_automation_update_tenant AFTER UPDATE OF tenant_id ON automation_rules
WHEN OLD.tenant_id<>NEW.tenant_id BEGIN
  UPDATE configuration_admission_population SET row_count=row_count-1,
    content_bytes=content_bytes-(
      length(CAST(COALESCE(OLD.tenant_id,'') AS BLOB))+length(CAST(COALESCE(OLD.id,'') AS BLOB))+
      length(CAST(COALESCE(OLD.name,'') AS BLOB))+length(CAST(COALESCE(OLD.event_type,'') AS BLOB))+
      length(CAST(COALESCE(OLD.conditions,'') AS BLOB))+length(CAST(COALESCE(OLD.action_type,'') AS BLOB))+
      length(CAST(COALESCE(OLD.action_config,'') AS BLOB))+length(CAST(COALESCE(OLD.created_at,'') AS BLOB))+
      length(CAST(COALESCE(CAST(OLD.is_active AS TEXT),'') AS BLOB))),
    revision=revision+1 WHERE tenant_id=OLD.tenant_id AND family='automation';
  INSERT INTO configuration_admission_population(tenant_id,family,row_count,content_bytes,revision)
  VALUES(NEW.tenant_id,'automation',1,
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.event_type,'') AS BLOB))+
    length(CAST(COALESCE(NEW.conditions,'') AS BLOB))+length(CAST(COALESCE(NEW.action_type,'') AS BLOB))+
    length(CAST(COALESCE(NEW.action_config,'') AS BLOB))+length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+
    length(CAST(COALESCE(CAST(NEW.is_active AS TEXT),'') AS BLOB)),1)
  ON CONFLICT(tenant_id,family) DO UPDATE SET row_count=row_count+1,
    content_bytes=content_bytes+excluded.content_bytes,revision=revision+1;
  DELETE FROM automation_admission_targets WHERE tenant_id=OLD.tenant_id AND automation_id=OLD.id;
  INSERT INTO automation_admission_targets(tenant_id,automation_id,content_bytes,revision)
  VALUES(NEW.tenant_id,NEW.id,
    length(CAST(COALESCE(NEW.tenant_id,'') AS BLOB))+length(CAST(COALESCE(NEW.id,'') AS BLOB))+
    length(CAST(COALESCE(NEW.name,'') AS BLOB))+length(CAST(COALESCE(NEW.event_type,'') AS BLOB))+
    length(CAST(COALESCE(NEW.conditions,'') AS BLOB))+length(CAST(COALESCE(NEW.action_type,'') AS BLOB))+
    length(CAST(COALESCE(NEW.action_config,'') AS BLOB))+length(CAST(COALESCE(NEW.created_at,'') AS BLOB))+
    length(CAST(COALESCE(CAST(NEW.is_active AS TEXT),'') AS BLOB)),1);
END;

CREATE TABLE configuration_mutation_receipts (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN
    ('dashboard.ticket-field.create','dashboard.automation.create','dashboard.automation.update','dashboard.automation.delete')),
  key_hash TEXT NOT NULL CHECK(length(key_hash)=64 AND key_hash NOT GLOB '*[^0-9a-f]*'),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  response_status INTEGER NOT NULL CHECK(response_status IN (200,201)),
  response_bytes INTEGER NOT NULL CHECK(response_bytes >= 0 AND response_bytes=length(CAST(response_snapshot AS BLOB))),
  reserved_d1_rows_read INTEGER NOT NULL CHECK(reserved_d1_rows_read >= 4096),
  response_snapshot TEXT NOT NULL CHECK(json_valid(response_snapshot)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch()+86400),
  PRIMARY KEY(tenant_id,principal_id,operation,key_hash)
);
CREATE INDEX idx_configuration_receipts_expiry
  ON configuration_mutation_receipts(tenant_id,principal_id,expires_at);
CREATE INDEX idx_ticket_fields_tenant_name_id ON ticket_fields(tenant_id,name,id);
CREATE INDEX idx_automation_rules_tenant_created_id ON automation_rules(tenant_id,created_at DESC,id);
