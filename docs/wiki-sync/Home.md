# Tocyn Wiki

[![Sponsor Tocyn](https://shieldcn.dev/github/sponsors/nathcymru.svg)](https://github.com/sponsors/nathcymru)

Tocyn is an open-source, multi-tenant omnichannel helpdesk being built for Cloudflare's edge application stack: a unified human workspace, shared headless portal/widget interfaces, verified external-channel adapters and governed AI operations around canonical conversation state. It is **pre-release** and the Tocyn project does not currently operate a hosted customer helpdesk service.

## Start points

- **New to the project:** [[Start-here]]
- **How Tocyn works:** [[System-architecture]]
- **Tenant/security model:** [[Architecture-and-tenant-isolation]]
- **Channels:** [[Channels-and-conversation-model]]
- **AI and governed autonomous operations:** [[AI-and-autonomous-operations]]
- **Approved roadmap:** [[Approved-architectural-roadmap]]
- **Releases and milestone model:** [[Roadmap-and-releases]]
- **Architecture decisions:** [[Architecture-decision-records]]
- **Privacy engineering:** [[PRIVACY_ARCHITECTURE]]
- **GDPR deployer technical guide:** [[GDPR_COMPLIANCE_USER_GUIDE]]
- **Deployment/costs:** [[Deployment-and-operating-costs]]

## Status discipline

Wiki pages distinguish **Implemented**, **Approved / planned**, and **Not yet implemented**. An approved roadmap item is not a deployment claim.

The local human-led API/portal beta was accepted on 9 September 2026 at
`049ea82a02571681f834bcd87d43253603edf71f` and formally published as
`v0.4.0-beta.1` on 10 September 2026 (PR #125 evidence). It used synthetic data
and local mail capture; no remote application deployment occurred. Future `beta.2`
requires the Operator Workspace gate with full SLA/ownership/routing acceptance.

## Contributors

Tocyn is improved by contributors across code, documentation, testing, issue reports, design feedback and review.

[![Tocyn contributors](https://shieldcn.dev/contributors/nathcymru/Tocyn.svg)](https://github.com/nathcymru/Tocyn/graphs/contributors)

See the repository [CONTRIBUTORS.md](https://github.com/nathcymru/Tocyn/blob/main/CONTRIBUTORS.md) and [CONTRIBUTING.md](https://github.com/nathcymru/Tocyn/blob/main/CONTRIBUTING.md).

## Support Tocyn

Optional sponsorship helps cover project-related hosting, documentation, testing and development-service costs. Tocyn has three monthly GitHub Sponsors tiers: **$1**, **$3**, and **$5**. Sponsorship does not buy private features, roadmap priority, an SLA or a hosted Tocyn service.

[![Tocyn sponsors](https://shieldcn.dev/sponsors/nathcymru.svg)](https://github.com/sponsors/nathcymru)

See [SPONSORS.md](https://github.com/nathcymru/Tocyn/blob/main/SPONSORS.md) or [sponsor Tocyn on GitHub](https://github.com/sponsors/nathcymru).

## Repository sources

The repository contains version-controlled architecture/privacy source under `docs/`, plus community/security policies at root. Where a Wiki page and repository technical page cover the same architecture, code and the reviewed repository source are implementation authority; Wiki is the navigable public presentation.


SLA #73 is accepted through signed [PR#180](https://github.com/nathcymru/Tocyn/pull/180), with local calendar, pause/resume, tenant isolation, customer-handler, browser and Safari/VoiceOver evidence. Capacity-aware routing#137 and the full beta.2#140 gate remain outstanding; this is not production clearance.

Composer #68 is accepted through signed [PR #183](https://github.com/nathcymru/Tocyn/pull/183), with safe versioned Markdown/plain rendering, durable draft continuity, local email and browser/VoiceOver evidence. Downstream AI/context providers remain their own pending work.

Resource-budget foundation [PR #182](https://github.com/nathcymru/Tocyn/pull/182) and staff admission [PR #190](https://github.com/nathcymru/Tocyn/pull/190) are integrated through signed `a4cddf2737ceb5f9f6e8d940e4b3c3153f4fbaf5`, with matching tested contents and required CI/CodeQL. These add bounded configured API/staff mutation grants, policy renewal, transaction receipts and bounded realtime/email foundations. Full #64 application-path enforcement and recovery remain incomplete; customer integration, collaboration and durable activity work are active. Local-only restrictions and the full beta.2 gate remain in effect.
