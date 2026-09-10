# Article marker compatibility contract

Owner approval: [#152](https://github.com/nathcymru/Tocyn/issues/152),10September2026. This bounded correction does not complete tenant knowledge ingestion or the wider assistant contract.

The existing authenticated, MFA-protected operator endpoint accepts `answer`, `sop` or `null` for an article marker. Malformed JSON and unsupported markers are rejected with400 before mutation. Tenant scope and role checks remain mandatory.

SOP means an internal procedure. Public/service-user retrieval remains Answer-only: the reader rechecks current tenant-owned source rows and excludes SOP, internal articles and legacy Question markers even when vector metadata is stale. Marking alone is not proof of successful indexing or delivery.

Existing `question` rows remain readable and are not silently converted or deleted. The coordinated UI update in #48 identifies these as legacy compatibility state. A later explicit compatibility decision is required for changing them through that UI.

No database migration is needed: the existing0014tenant migration replaced the earlier restricted article table. New validation belongs at the request boundary; historical migrations remain unchanged.

Validation uses the full migrated local SQLite schema with tenant-qualified repositories, synthetic embedding/vector doubles, handler negative tests and local Miniflare tenant checks. This is not evidence of live provider operation or production readiness. See `.agents/state/knowledge-152.md` for the scoped evidence and pending integration gates.
