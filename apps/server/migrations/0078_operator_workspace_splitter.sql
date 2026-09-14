ALTER TABLE operator_workspace_state ADD COLUMN splitter_ratio INTEGER NOT NULL DEFAULT 32 CHECK (splitter_ratio BETWEEN 24 AND 50);
