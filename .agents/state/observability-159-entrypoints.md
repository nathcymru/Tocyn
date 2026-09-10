# #159 resource instrumentation preparation

Read-only inventory completed by evidence_copyedit10September2026; coordinator checked source symbols/resource calls and existence of the cited tests. These are source candidates, not proof that every method is reachable in each runtime. Trace the current tenant composition and handler before attaching measurements. No resource instrumentation or test coverage beyond inspected evidence is claimed.

| Candidate source (under apps/server/src) | Resource | Existing test locations (under apps/server/src) |
|---|---|---|
| services/ticket.service.ts, TicketService | D1 statements/batches and R2 body/attachment operations | services/__tests__/ticket.service.test.ts; services/__tests__/review-regressions.test.ts |
| repositories/index.ts | Tenant-scoped D1 persistence and batches | repositories/__tests__/tenant.repository.test.ts; repositories/__tests__/migrations.test.ts |
| repositories/local-beta-admission.repository.ts | D1 admission, counters and receipts in mutation batches | repositories/__tests__/local-beta-admission.test.ts |
| services/storage.service.ts, StorageService | R2 put/get and response metadata | services/__tests__/storage.service.test.ts; services/__tests__/attachment-references.test.ts |
| services/broadcast.service.ts, BroadcastService | Tenant-qualified NotificationDO lookup and notifications | services/__tests__/broadcast.service.test.ts; durable_objects/__tests__/NotificationDO.test.ts |
| workflows/vectorize.workflow.ts, VectorizeWorkflow.run | Workflow/system tenant composition and AI | services/__tests__/knowledge.service.test.ts mocks the trigger; real workflow evidence remains separate |
| services/knowledge.service.ts, KnowledgeService | D1 repositories, R2, Vectorize and AI | services/__tests__/knowledge.service.test.ts; services/__tests__/vector.service.test.ts; services/__tests__/ai.service.test.ts |
| handlers/widget.handler.ts | Tenant repositories, canonical ticket creation and stateless AI | services/__tests__/widget-visibility.test.ts; handlers/__tests__/customer.handler.test.ts; services/__tests__/ai.service.test.ts |

Next: select a current active entry point, trace its trusted request/tenant composition and operation result contract, then add bounded allowlisted measurements with failure isolation and resource accounting. Preserve atomic D1 writes/admission fences, canonical audit and actual error identity. Never log raw SQL, tenant/object keys, authentication material or content. Pipeline extension points remain #51/#91/#87/#88 ownership. Local beta disables vector workflows; this inventory does not authorize enabling AI/providers or remote resources.

The current clean9aa90c9 local receipt covers only60measurements across health and authenticated/unauthenticated metadata, with disposed Miniflare resources. All CI on9aa90c9 passed. D1/R2/DO/Workflow/AI/canonical-write measurements and environment/cost configuration remain incomplete; receipt inventory counts are not billed operations. Worker completed without edits or external actions; model/effort metadata unavailable on resume, no model change or separate allowance claimed.
