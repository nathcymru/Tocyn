# Ready queue: remaining administration admission under #64

Verified against PR205 e976c87 (accepted application base PR203). This is required remaining #64 work, not a new product capability. No implementation is claimed. Root integration owner; assign only after an existing worker is available.

## Bounded next implementation

Ticket-field GET/POST and automation GET/POST/PATCH/DELETE in `apps/server/src/handlers/dashboard.handler.ts` remain direct repository operations without budget admission. Corresponding `SqlTicketFieldRepository` and `SqlAutomationRepository` are in `apps/server/src/repositories/index.ts` (around923 and847). Existing schema is migration0017; automation index is tenant/event/is_active, ticket fields have tenant/name uniqueness. Ticket-field duplicate creation currently returns409; preserve that outcome. Automation updates retain untouched values and expose current full result; do not fetch large stored conditions/configuration before reservation. Automation execution/retention is separate from these configuration endpoints and must remain valid.

Reuse accepted admission contracts: current credential/MFA/capability and exact reservation/closure at the actual D1 boundary; single-use authority; bounded request bodies and immutable keyed outcomes where applicable; no silently truncated historical lists. Price lists from maintained tenant row/byte metadata, with atomic growth/version fences. Any new counter migration must include native measurements of affected existing retention/source paths; triggers consume writes. Reserve migration number with coordinator before editing.

Acceptance evidence: real local Worker/D1 positive and revoked-session/MFA/permission/policy/grant-closure denial, two-tenant negative cases, duplicate/missing semantics, stale target and population-growth races, retry/failure outcomes and actual whole-attempt row usage. Register native tests in shared CI via root. Keep zero Copilot, local synthetic only, no owner budget-ceiling changes. Node22 and existing local dependency overlays only.

## Separate security-sensitive successor

API-key management routes GET/POST/DELETE also remain direct operations. `SqlApiKeyRepository` starts around773. Lists intentionally exclude key hashes/secrets; creation returns plaintext once. Do not reuse generic plaintext response receipts: preserve one-time secret semantics and ensure retries cannot create unnoticed duplicate credentials. Creation, deletion/revocation, and authentication `recordUsage` require explicit accounting/authority analysis. This deserves adequate security effort rather than a mechanical generic CRUD wrapper. It is not included in the ticket-field/automation worker scope above.

Allocation: existing dedicated Codex worker, medium capability/effort sufficient for normal config implementation, high effort for concrete authorization or recovery ambiguity. Actual reusable workers are Sol/high and cannot be reconfigured through followup; do not claim a model change or independent allowance. No API billing or purchases. Root owns PR integration and exact-head checks.
