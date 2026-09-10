# ADR-0025 — Tenant AI is a logical retrieval boundary, not a separately trained model

- **Status:** Accepted direction; implementation pending
- **Date:** 10 September 2026

## Context

Tocyn already contains R2/D1/Vectorize/Workers-AI RAG foundations. Older Phase 1 documentation predates the accepted multi-tenant isolation model and includes PDF-storage and single-tenant assumptions that are not sufficient for the intended product.

The product requirement is that each tenant has its own AI assistant context and can add PDF knowledge, without introducing a large set of third-party knowledge-sync integrations.

## Decision

A Tocyn tenant AI assistant is defined by an isolated **logical retrieval and authorisation scope**, not by requiring a separately fine-tuned inference model for every tenant.

Shared inference models may be used. For each request, Tocyn must:

1. derive verified tenant identity server-side;
2. derive the actor's knowledge visibility/permissions;
3. retrieve only sources/vectors eligible for that tenant and actor;
4. revalidate source ownership before R2 hydration;
5. bound context;
6. expose source/page/version provenance;
7. preserve deterministic/manual behaviour when AI is unavailable or disabled.

PDF is the only new external document-ingestion format approved by this ADR. PDF processing is asynchronous and versioned. Image-only/OCR-dependent PDFs may fail visibly as unsupported/`requires_ocr` until OCR is separately approved.

Third-party knowledge synchronization (for example Zendesk, Confluence, Notion, Guru, Salesforce, Freshdesk, Box, GitHub or website crawling) is outside this decision.

Vector metadata helps filter retrieval but never constitutes access authority.

## Consequences

- Tenant isolation does not depend on an LLM prompt instruction.
- A shared model can remain operationally economical without mixing retrieval scope.
- Internal/operator-only knowledge can be distinguished from public/service-user knowledge.
- Updating/deleting a source must update/delete its derived vectors and cached/derived artefacts.
- Old single-tenant RAG documentation must be marked historical or corrected.
- #77 can consume this retrieval contract without being expanded into document ingestion.

## Related

- ADR-0015 — Privacy metadata is not an access-control authority
- issues #50, #76, #77, #79
- `docs/phase-1.7-rag-spec.md`
- approved M9.2

## Source and current authority

Source archive: `tocyn-product-gap-change-package-2026-09-10.zip`; original path: `tocyn-product-gap-change-package-2026-09-10/adrs/ADR-0019-tenant-knowledge-grounding-and-document-ingestion.md`. Source numbering is preserved in the archive; this accepted record uses the master numbering.

Delivery owners: [#151](https://github.com/nathcymru/Tocyn/issues/151), [#152](https://github.com/nathcymru/Tocyn/issues/152).

The [approved master decisions](../planning/post-beta-2026-09-10/decisions.md) supersede any conflicting source sequencing or release assumption: beta.1 was accepted 9 September and published 10 September 2026 at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full SLA clocks/calendars/pause/resume/waiting treatment and responsible-handler ownership/routing. Independent workspace and hardening foundations proceed in parallel. Existing historical baselines are preserved; milestone taxonomy may evolve to represent dependencies. This ADR grants no remote provisioning, provider activation or customer-traffic authority.
