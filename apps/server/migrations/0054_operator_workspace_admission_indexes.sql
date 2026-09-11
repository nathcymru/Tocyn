-- Actor-qualified bounded cleanup and indicator pages. Existing expiry/ticket
-- indexes cannot seek one operator's expired prefix without scanning peers.
CREATE INDEX IF NOT EXISTS idx_operator_drafts_actor_expiry
  ON operator_drafts(tenant_id,user_id,expires_at,updated_at);
CREATE INDEX IF NOT EXISTS idx_operator_drafts_actor_ticket
  ON operator_drafts(tenant_id,user_id,ticket_id);

-- One maintained row lets admission reserve for the complete actor population
-- without first scanning that population. Draft writes and cascades update it in
-- the same SQLite transaction as the source row.
CREATE TABLE operator_draft_actor_population (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  draft_count INTEGER NOT NULL CHECK (draft_count > 0),
  PRIMARY KEY (tenant_id,user_id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);

INSERT INTO operator_draft_actor_population(tenant_id,user_id,draft_count)
SELECT tenant_id,user_id,COUNT(*) FROM operator_drafts GROUP BY tenant_id,user_id;

CREATE TRIGGER operator_drafts_population_insert
AFTER INSERT ON operator_drafts BEGIN
  INSERT INTO operator_draft_actor_population(tenant_id,user_id,draft_count)
  VALUES (NEW.tenant_id,NEW.user_id,1)
  ON CONFLICT(tenant_id,user_id) DO UPDATE SET draft_count=draft_count+1;
END;

CREATE TRIGGER operator_drafts_population_delete
AFTER DELETE ON operator_drafts BEGIN
  DELETE FROM operator_draft_actor_population
    WHERE tenant_id=OLD.tenant_id AND user_id=OLD.user_id AND draft_count=1;
  UPDATE operator_draft_actor_population SET draft_count=draft_count-1
    WHERE tenant_id=OLD.tenant_id AND user_id=OLD.user_id;
END;

CREATE TRIGGER operator_drafts_population_move
AFTER UPDATE OF tenant_id,user_id ON operator_drafts
WHEN OLD.tenant_id<>NEW.tenant_id OR OLD.user_id<>NEW.user_id BEGIN
  DELETE FROM operator_draft_actor_population
    WHERE tenant_id=OLD.tenant_id AND user_id=OLD.user_id AND draft_count=1;
  UPDATE operator_draft_actor_population SET draft_count=draft_count-1
    WHERE tenant_id=OLD.tenant_id AND user_id=OLD.user_id;
  INSERT INTO operator_draft_actor_population(tenant_id,user_id,draft_count)
  VALUES (NEW.tenant_id,NEW.user_id,1)
  ON CONFLICT(tenant_id,user_id) DO UPDATE SET draft_count=draft_count+1;
END;
