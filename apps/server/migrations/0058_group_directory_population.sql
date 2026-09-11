-- Dynamic directory admission reads one maintained row before reserving the
-- complete tenant/group population. These counters never impose a product cap.
CREATE TABLE group_directory_tenant_population (
  tenant_id TEXT PRIMARY KEY,
  user_count INTEGER NOT NULL DEFAULT 0 CHECK (user_count >= 0),
  group_count INTEGER NOT NULL DEFAULT 0 CHECK (group_count >= 0)
);

CREATE TABLE group_directory_member_population (
  tenant_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  member_count INTEGER NOT NULL CHECK (member_count > 0),
  PRIMARY KEY (tenant_id,group_id)
);

INSERT INTO group_directory_tenant_population(tenant_id,user_count,group_count)
SELECT tenant_id,
  (SELECT COUNT(*) FROM users u WHERE u.tenant_id=tenants.tenant_id),
  (SELECT COUNT(*) FROM groups g WHERE g.tenant_id=tenants.tenant_id)
FROM (SELECT tenant_id FROM users UNION SELECT tenant_id FROM groups) tenants;

INSERT INTO group_directory_member_population(tenant_id,group_id,member_count)
SELECT tenant_id,group_id,COUNT(*) FROM user_groups GROUP BY tenant_id,group_id;

CREATE TRIGGER group_directory_users_insert AFTER INSERT ON users BEGIN
  INSERT INTO group_directory_tenant_population(tenant_id,user_count,group_count)
  VALUES (NEW.tenant_id,1,0)
  ON CONFLICT(tenant_id) DO UPDATE SET user_count=user_count+1;
END;

CREATE TRIGGER group_directory_users_delete AFTER DELETE ON users BEGIN
  UPDATE group_directory_tenant_population SET user_count=user_count-1 WHERE tenant_id=OLD.tenant_id;
END;

CREATE TRIGGER group_directory_users_move AFTER UPDATE OF tenant_id ON users
WHEN OLD.tenant_id<>NEW.tenant_id BEGIN
  UPDATE group_directory_tenant_population SET user_count=user_count-1 WHERE tenant_id=OLD.tenant_id;
  INSERT INTO group_directory_tenant_population(tenant_id,user_count,group_count)
  VALUES (NEW.tenant_id,1,0)
  ON CONFLICT(tenant_id) DO UPDATE SET user_count=user_count+1;
END;

CREATE TRIGGER group_directory_groups_insert AFTER INSERT ON groups BEGIN
  INSERT INTO group_directory_tenant_population(tenant_id,user_count,group_count)
  VALUES (NEW.tenant_id,0,1)
  ON CONFLICT(tenant_id) DO UPDATE SET group_count=group_count+1;
END;

CREATE TRIGGER group_directory_groups_delete AFTER DELETE ON groups BEGIN
  UPDATE group_directory_tenant_population SET group_count=group_count-1 WHERE tenant_id=OLD.tenant_id;
END;

CREATE TRIGGER group_directory_groups_move AFTER UPDATE OF tenant_id ON groups
WHEN OLD.tenant_id<>NEW.tenant_id BEGIN
  UPDATE group_directory_tenant_population SET group_count=group_count-1 WHERE tenant_id=OLD.tenant_id;
  INSERT INTO group_directory_tenant_population(tenant_id,user_count,group_count)
  VALUES (NEW.tenant_id,0,1)
  ON CONFLICT(tenant_id) DO UPDATE SET group_count=group_count+1;
END;

CREATE TRIGGER group_directory_members_insert AFTER INSERT ON user_groups BEGIN
  INSERT INTO group_directory_member_population(tenant_id,group_id,member_count)
  VALUES (NEW.tenant_id,NEW.group_id,1)
  ON CONFLICT(tenant_id,group_id) DO UPDATE SET member_count=member_count+1;
END;

CREATE TRIGGER group_directory_members_delete AFTER DELETE ON user_groups BEGIN
  DELETE FROM group_directory_member_population
    WHERE tenant_id=OLD.tenant_id AND group_id=OLD.group_id AND member_count=1;
  UPDATE group_directory_member_population SET member_count=member_count-1
    WHERE tenant_id=OLD.tenant_id AND group_id=OLD.group_id;
END;

CREATE TRIGGER group_directory_members_move AFTER UPDATE OF tenant_id,group_id ON user_groups
WHEN OLD.tenant_id<>NEW.tenant_id OR OLD.group_id<>NEW.group_id BEGIN
  DELETE FROM group_directory_member_population
    WHERE tenant_id=OLD.tenant_id AND group_id=OLD.group_id AND member_count=1;
  UPDATE group_directory_member_population SET member_count=member_count-1
    WHERE tenant_id=OLD.tenant_id AND group_id=OLD.group_id;
  INSERT INTO group_directory_member_population(tenant_id,group_id,member_count)
  VALUES (NEW.tenant_id,NEW.group_id,1)
  ON CONFLICT(tenant_id,group_id) DO UPDATE SET member_count=member_count+1;
END;

CREATE INDEX idx_groups_tenant_created_id ON groups(tenant_id,created_at,id);
CREATE INDEX idx_users_tenant_created_id ON users(tenant_id,created_at DESC,id);
CREATE INDEX idx_users_tenant_role_created_id ON users(tenant_id,role,created_at DESC,id);
CREATE INDEX idx_user_groups_tenant_group_user ON user_groups(tenant_id,group_id,user_id);
CREATE INDEX idx_tickets_tenant_group ON tickets(tenant_id,group_id);
