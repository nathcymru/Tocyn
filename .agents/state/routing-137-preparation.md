# #137 routing ready-queue preparation

Read-only native Luna/medium preparation11September2026; owner root. Current approved issue137 remains beta2-blocker, dependencies73/79/162/130; no implementation or acceptance claimed. Do not wait for full85 autonomous analytics.

Reuse accepted162 `OperationalMetricsRepository.currentWork()` v2026-09-11.3: current open/pending visible work, bounded1000+sentinel,60s freshness, capped per-assignee projection and explicit unavailable/truncated states. It revalidates role/session/group in one D1 statement. Do not reinterpret current load as historical performance or presence as availability.

Implementation sequence once contracts are ready: tenant-qualified availability/ceiling state; atomic assignment predicate for live role/session/group/availability/ceiling/current load; deterministic fair selection and explicit all-full fallback; separately authorized audited override; queue/SLA-risk integration; concurrent/tenant-negative/revocation tests. Existing tickets assignment/group composite FKs, user_groups and0032 covering indexes are reuse points. `ConversationAuditRepository.updateWithEvents()` performs ticket update and assignment audit in one batch; extend this mutation seam rather than writing assignments outside it.

Creation also accepts assignment fields and must use the same capacity gate. Neither group membership alone nor client last-active/presence is availability authority. Read current issue before implementation; root must integrate full73 and130 contracts. No numerical ceilings or override privileges invented by this preparation.

## #130 queue and durable mention sequencing

Luna/medium verified #130 exact prerequisites129/136/73/64 and existing operator workspace view/sort/filter types, actor/tenant CAS state and SqlTicketRepository.list compatibility seam. Views include all/mine/unassigned/mentions/drafts/snoozed/needs_action/custom; use authoritative predicates/counts/freshness, not browserfilter approximations. Reuse162 bounded current-work denominators. No routing logic in130.

There is no existing durable mention repository. #70 owns mention production; #133 owns durable activity but its UI depends128, while128 depends130. Do not add a whole-issue133 prerequisite to130, and do not accept an unavailable mentions provider as completed130. Under the owner's explicit decomposition authority, plan a partial133 durable-backend increment (Progresses133) alongside70 after68 contracts, enabling a real tenant/actor-scoped mentions projection before full130 acceptance. Then128 workspace UI and remaining133 UI/acceptance follow. This preserves all issue ownership and acceptance; the backend's precise technical inputs must be verified before implementation. No issueclosure or historicaldependencyrewrite is authorized by this preparation.
