# #64 knowledge/indexing preparation — 11 September 2026

## Scope and authority

This is a shared prerequisite contribution under #64. The coordinator explicitly
authorised the minimal durable per-chunk source-version/manifest/job accounting
needed to make active indexing safe. It remains neither #151 PDF ingestion/full
lifecycle nor #152 retrieval/provenance completion. It may schedule active work,
but must not claim prior HTTP routes already did. ADR-0025 requires server-derived
tenant and actor visibility, source ownership revalidation before hydration,
bounded context, provenance, and deterministic/manual behaviour when AI is
unavailable.

## Corrected discovery

The active `knowledge.handler` creates `TenantKnowledgeService`, not legacy
`KnowledgeService`. Its upload/create/update/publish and QA marker paths directly
write R2/D1, call BGE and upsert Vectorize in the HTTP request. They currently
model all content as one chunk, despite the supported upload limit being 10 MiB.
`getArticleContent` reads the complete R2 object. Delete and QA cleanup derive a
fanout from `chunk_count` with legacy fallbacks.

`VectorizeWorkflow` remains exported and bound, but active imports did not call
`VECTORIZE_WORKFLOW.create`; legacy `KnowledgeService` was the only caller. It is
therefore a required job-entry point, not evidence of prior active HTTP enqueueing.

## Proposed safe seam

1. Retain the accepted source in tenant-scoped R2 and record a tenant-scoped
   source/version record plus a finite chunk manifest before optional provider
   work. Source content is never silently truncated to fit embedding limits.
2. Split text deterministically on UTF-8 boundaries into chunks whose byte cap is
   no greater than the BGE 512-token safe bound. The bound and its source must be
   catalogue-owned. At most one manifest chunk is admitted and processed at a
   time; admission covers that chunk's BGE/Vectorize/D1/R2/workflow overhead and
   its finite recovery attempt.
3. A worker rechecks current tenant, source version, status and tier before each
   provider call and stores terminal chunk state durably. It never trusts vector
   metadata for authorization. Vector metadata carries source/version/chunk and
   visibility fields plus the bounded (at most 512 UTF-8 byte) chunk text required
   by current staff/widget consumers; it never carries unbounded source text.
4. Promotion only exposes a completed current version. Withdrawal/delete first
   revokes D1 visibility, retains a bounded cleanup manifest, then retries vector
   and derived-object cleanup without losing ownership. This is required for #151
   versioning and #152 current public visibility, not an assertion about today.
5. When AI is disabled, denied, exhausted or a provider fails, no AI/Vectorize
   call occurs. The retained source stays available through deterministic/manual
   knowledge paths with an explicit non-indexed/pending state.

## Bound and ownership gap

The existing 10 MiB supported source permits at most 20,561 chunks at a 512-byte
cap: three-byte UTF-8 scalars leave two bytes unused per chunk. A one-shot reservation/enqueue cannot safely cover that work; independent
durable per-chunk admission is required. #151 owns PDF extraction, page provenance,
full version promotion/rollback/delete lifecycle and UI status. #152 owns expanded
public/internal retrieval and citations. This #64 contribution owns only enough
source-version, manifest and job state to resume bounded indexing and cleanup
without losing ownership. Migration 0051 is reserved if implementation requires it.

## Next action

Implemented in this branch: migration 0051, a tenant-scoped manifest, bounded
UTF-8 chunking, current-version validation, durable continuation claims, an
explicitly admitted system workflow chunk, and versioned widget hydration. A
source is `source_pending` until R2 has completed and every manifest row plus
the job have been committed; failed publication removes its partial pending rows
and records `failed`. A superseding source revokes older versions and retains
their vector identifiers for cleanup. A provider failure records `uncertain`;
it never resets a provider claim into an uncharged retry.

The current provider evidence is the dated repository catalogue
`docs/cost-resource-catalogue.md` version `cf-2026-09-10`, inspected 10
September 2026: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/),
[BGE Large model documentation](https://developers.cloudflare.com/workers-ai/models/bge-large-en-v1.5/),
[Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/),
and [Workflows pricing](https://developers.cloudflare.com/workers/platform/pricing/).
The code keeps the currently catalogued BGE Large 1,024 dimensions and
512-token ceiling; it does not substitute a deprecated or unverified model.

Native disposable Miniflare tests now prove: exact multibyte preservation for a
10 MiB source; all chunks at or below 512 bytes; current/stale cleanup
ownership; a synthetic 1,024-dimension embedding completing real D1/R2 source
work; and an actual local Workflow leaving work pending with AI admission off.
The installed Miniflare AI binding is remote-only, so no provider integration
was run. #151 still owns PDF/page lifecycle and #152 broader retrieval/citation
work. Knowledge-source writes now have separate bounded current-staff admission
in combined policy mode, covering actual source bytes, worst-case manifest
writes, R2 publication and the initial durable workflow schedule. Absent/off
policy retains the documented manual/pending source without provider work.
Versioned QA cleanup uses retained `vector_id` rows under the existing ticket
retention claim in batches of 100; historical QA IDs retain their bounded
fallback. Scheduled retention admission/pagination remains follow-on work.
