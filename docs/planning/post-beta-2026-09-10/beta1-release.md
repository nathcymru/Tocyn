Accepted local-only private-beta checkpoint, tested and accepted on **9 September 2026**. Published now to formalise that existing checkpoint; publication is not backdated.

Tag target: `049ea82a02571681f834bcd87d43253603edf71f` (verified signed merge, PR #124). Final acceptance evidence was subsequently recorded in [PR #125](https://github.com/nathcymru/Tocyn/pull/125), an evidence-only change, and [the readiness report](https://github.com/nathcymru/Tocyn/blob/93de1b975a45edd9d28ca70edd725b60deb6b275/docs/private-beta-readiness.md).

Scope: local Wrangler API, standalone operator dashboard and customer portal, two synthetic tenants, locally captured authentication mail, mandatory operator authentication/MFA, canonical intake/replies, tenant isolation, attributable audit and bounded resource guardrails. Actual Safari/VoiceOver acceptance and the complete 46-command final rehearsal are recorded in the linked evidence. Required CI and all three CodeQL analyses passed on the accepted application revision.

The disposable verification environment was cleaned up. Start a fresh fixture using the [local beta instructions](https://github.com/nathcymru/Tocyn/blob/049ea82a02571681f834bcd87d43253603edf71f/docs/local-beta-guardrails.md); credentials are generated per run and no credentials or deployment artifacts are attached to this release.

Known limitations: local synthetic acceptance does not establish production runtime clearance, live-provider delivery, zero-cost guarantees, or future-channel accessibility. Frontend bundle warnings remain. Full operational budgets, durable Queue pipelines, redesigned workspace, full SLA, external channels and later helpdesk capabilities remain tracked work. Production readiness is separately owned by #42.

This prerelease records source and acceptance history. It does not deploy anything or authorise remote resources, real customer onboarding, external authentication email, live providers or production use. The next workspace candidate will be `v0.4.0-beta.2` after its approved testing gate passes.
