-- Legacy tokens represent version zero and become invalid at the first revocation.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER users_revoke_changed_authority AFTER UPDATE OF role, email, password_hash, mfa_enabled ON users
WHEN OLD.role IS NOT NEW.role OR OLD.email IS NOT NEW.email OR OLD.password_hash IS NOT NEW.password_hash OR OLD.mfa_enabled IS NOT NEW.mfa_enabled
BEGIN
  UPDATE users SET session_version = OLD.session_version + 1 WHERE tenant_id = NEW.tenant_id AND id = NEW.id;
END;
CREATE TRIGGER user_groups_revoke_removed_membership AFTER DELETE ON user_groups
BEGIN
  UPDATE users SET session_version = session_version + 1 WHERE tenant_id = OLD.tenant_id AND id = OLD.user_id;
END;
CREATE TRIGGER user_groups_revoke_changed_membership AFTER UPDATE ON user_groups
BEGIN
  UPDATE users SET session_version = session_version + 1 WHERE (tenant_id = OLD.tenant_id AND id = OLD.user_id) OR (tenant_id = NEW.tenant_id AND id = NEW.user_id);
END;
