-- Rebuild the version-constrained v1 table. Invalid historical rows abort the
-- migration; valid values, revisions and timestamps are preserved verbatim.
CREATE TABLE operator_presentation_preference_v2 (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 2 CHECK(version = 2),
  revision INTEGER NOT NULL CHECK(typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991),
  density TEXT NOT NULL CHECK(density IN ('comfortable','compact')),
  font_scale TEXT NOT NULL CHECK(font_scale IN ('normal','large','larger')),
  focus_mode INTEGER NOT NULL CHECK(focus_mode IN (0,1)),
  motion TEXT NOT NULL CHECK(motion IN ('system','reduced','full')),
  navigation TEXT NOT NULL DEFAULT 'compact' CHECK(navigation IN ('compact','labelled')),
  context_default TEXT NOT NULL DEFAULT 'remember' CHECK(context_default IN ('remember','conversation','details')),
  shortcuts_enabled INTEGER NOT NULL DEFAULT 1 CHECK(shortcuts_enabled IN (0,1)),
  interruption_level TEXT NOT NULL DEFAULT 'standard' CHECK(interruption_level IN ('standard','quiet')),
  advance_after_resolve INTEGER NOT NULL DEFAULT 0 CHECK(advance_after_resolve IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,user_id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);
INSERT INTO operator_presentation_preference_v2
  (tenant_id,user_id,version,revision,density,font_scale,focus_mode,motion,updated_at)
SELECT tenant_id,user_id,CASE WHEN version=1 THEN 2 ELSE 0 END,revision,density,font_scale,focus_mode,motion,updated_at
FROM operator_presentation_preference;
DROP TABLE operator_presentation_preference;
ALTER TABLE operator_presentation_preference_v2 RENAME TO operator_presentation_preference;
