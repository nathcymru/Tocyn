> **Historical beta delivery record.** Current coordination and ready queue: [post-beta alignment](post-beta-alignment.md). Preserve this evidence; do not execute its old next actions.

# Prepared successors after #60

Preparation only, 9 September 2026. No successor implementation or completion claim.
Current approved issue scope and ADRs govern; integrate only after #60 acceptance.

## #63 attributable conversation events

Approved scope: tenant-scoped intake, reply, assignment and state events; consistent
mutation/event persistence, safe metadata, authorised history, public/internal
visibility, reconstruction, attribution and failure/resource proof. No hidden model
reasoning, session QA or analytics. Can run alongside #93 with explicit boundaries.

Reuse #60 atomic mutation repository batch for API/portal intake/reply event insert.
Do not append events in a second transaction or on replay. Versioned replay snapshot
must remain stable; do not retroactively reinterpret stored v1 canonical responses.
Canonical audit fields currently explicitly not recorded. New event references need
truthful versioning and detail/history compatibility.

Existing API PATCH in v1.handler.ts updates then touches in separate operations;
dashboard PATCH does likewise. Assignment/state event and mutation must become one
scoped batch with actual prior/new values, including concurrent changes. Inspect
both paths and dashboard intake/reply service paths; beta human handling uses them.
Current canonical projector filters at caller boundary; history requires equally
strict current auth/tenant/ownership and public/internal filtering, including event
metadata that might reveal hidden messages or assignments. Actor identity comes
from resolved credentials, never body fields. Keep metadata allowlisted and bounded;
no raw credentials, captured email links, R2 paths or model reasoning.

Required proof: actual A/B credentials; reconstruction from ordered durable events;
exact actor provenance; mutation/event rollback together; concurrent transitions;
replay creates no duplicate event; unauthorised and internal-history negatives;
resource counts and cleanup/recovery. Do not introduce UI merely to prove history
if approved API acceptance suffices; any new UI needs its full accessibility checks.

## #93 bounded local admission

Read-only detailed inventory remains /tmp/tocyn-93-preparation.md. Implement narrow
server-side two-tenant/invited-principal admission, authoritative claimed mutation
ceilings, visible operator stop/re-enable, uniform request/attachment/page/batch
bounds, disabled AI/jobs/providers and bounded diagnostics. Current owner boundary
is local Wrangler and captured exact approved addresses only; no remote resources.

Reuse #60 replay/mutation boundary: a replay is not another admitted mutation;
concurrent hard ceilings and successful mutation need consistent durable accounting.
Do not replace them with per-isolate IP counters. Coordinate batch hook ownership
with #63; one issue owns shared repository edits and dependent branch integrates it.
API GET canonical attachments currently performs one scoped query per article.
Measure and bound this with pagination/read-resource acceptance; batching scoped
attachment retrieval is an available improvement, not proof of a hard ceiling.
#60 provides streamed 64 KiB create/reply and typed inputs; verify final integrated
coverage before repeating implementation. #90 broader cost accounting is excluded.
