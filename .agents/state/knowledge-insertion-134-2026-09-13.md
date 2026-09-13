# Guarded human knowledge reads — #134 / #140

Dedicated source base20d396de. Exact GET /api/knowledge/articles and GET /api/knowledge/articles/:id/content are admitted by local beta; all write, detail-only, upload, QA, AI and provider routes remain unchanged/disabled. The preserved candidate has no knowledge documents; this patch does not seed or alter it.

Verified current authMiddleware calls authorizeLocalBeta with the live verified tenant/staff principal before tenant dependency composition. tenantMiddleware preserves that scope and guarded LocalBetaAttachmentStorage. With BUDGET_ADMISSION_POLICY=ticket-mutations-v1, staff admission is enabled; knowledge admission cannot take its disabled branch. Invalid configuration or missing coordinator rejects. Auth/MFA/role/tenant and existing exact-operation read/R2 fences remain unchanged. Root reviewed and retained completed-business-read settlement before JSON; no lifecycle defect claim.

Focused route tests cover both positive GETs and unsupported verbs/subpaths/nonstaff variants. Existing knowledge native read evidence is reused rather than rerun unchanged; it does not prove integrated keyboard insertion. New isolated active-answer fixture is prepared in .agent-context only and remains stopped pending review/launch. No provider, knowledge write endpoint, candidate mutation or full acceptance claim.

Standing maintainer VoiceOver authorization includes configuring it and leaving it enabled; coordinator owns UI. Actual spoken output remains unverified. No model call; root retains scope/security/accounting review. Project progress and baseline/forecast fields are preserved pending actual acceptance evidence.
