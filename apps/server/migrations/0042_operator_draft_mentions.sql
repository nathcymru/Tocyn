-- Persist bounded internal mention intent with the acknowledged operator draft.
-- Recipient access is checked again inside the canonical note/activity batch.
ALTER TABLE operator_drafts ADD COLUMN mentioned_user_ids TEXT NOT NULL DEFAULT '[]' CHECK (
  json_valid(mentioned_user_ids) AND json_type(mentioned_user_ids) IS 'array'
  AND length(CAST(mentioned_user_ids AS BLOB)) <= 1024
);
