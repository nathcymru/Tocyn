CREATE TABLE operator_presentation_preference (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version = 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  density TEXT NOT NULL CHECK(density IN ('comfortable','compact')),
  font_scale TEXT NOT NULL CHECK(font_scale IN ('normal','large','larger')),
  focus_mode INTEGER NOT NULL CHECK(focus_mode IN (0,1)),
  motion TEXT NOT NULL CHECK(motion IN ('system','reduced','full')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,user_id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);
