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

Resource-budget foundation [PR #182](https://github.com/nathcymru/Tocyn/pull/182) and staff admission [PR #190](https://github.com/nathcymru/Tocyn/pull/190) are integrated through signed `a4cddf2737ceb5f9f6e8d940e4b3c3153f4fbaf5`, with matching tested contents and required CI/CodeQL. These add bounded configured API/staff mutation grants, policy renewal, transaction receipts and bounded realtime/email foundations. [PR #194](https://github.com/nathcymru/Tocyn/pull/194) subsequently added whole API grant closure and bounded recovery at signed `ab8759d1948fd6862d0f2a11d093de27d434c053`, after required checks on the accepted branding base. Assigned and uncertain charges remain retained. [PR #191](https://github.com/nathcymru/Tocyn/pull/191) supplies the durable activity foundation; its producers and UI remain incomplete. Customer/widget mutation admission [PR #195](https://github.com/nathcymru/Tocyn/pull/195) and storage/history admission [PR #196](https://github.com/nathcymru/Tocyn/pull/196) are accepted through signed `4e2f6d405713974af44a78e42d69157a13538dcf`. They add current-authority checks, bounded history projection, atomic local upload attempts and certified recovery compaction. Full #64 application-path enforcement, provider/CPU accounting and lifecycle recovery remain open. Local-only restrictions and the full beta.2 gate remain in effect.

Collaboration [PR #189](https://github.com/nathcymru/Tocyn/pull/189) is accepted at signed `6497b55c88948233d76b5cd15165fbbbb0bc15d5`, including recoverable 48-hour drafts, bounded internal mentions, retry/collision tests and local Safari/VoiceOver evidence. #70 remains open for the #132-owned interruption preference integration; #133 still requires its attention UI. These are partial capability deliveries, not beta.2 acceptance.

API ticket update admission [PR #197](https://github.com/nathcymru/Tocyn/pull/197) is accepted at signed `28e0444209d96f821d1214154386e40414e9bfa5`, preserving keyed retry/conflict behavior with atomic current-key authorization and audited update receipts. Required CI/security and tested-content/signature verification passed.

API detail, staff update and HTTP AI admission [PR #198](https://github.com/nathcymru/Tocyn/pull/198) is accepted at signed `101087423e56e20993342dcdf5934d95e69f3e5c`. Bounded staff/customer detail and history reads [PR #199](https://github.com/nathcymru/Tocyn/pull/199) are accepted at signed `922e2adfff7a0854b5bf612c894280201eae681a`. Required checks and tested-content/signature verification passed for both increments. Full application-path enforcement #64 and beta.2 #140 remain open.

Accepted budget increments: [PR200](https://github.com/nathcymru/Tocyn/pull/200) adds bounded support/SLA mutation admission with atomic remap clocks; [PR201](https://github.com/nathcymru/Tocyn/pull/201) adds realtime admission and current ticket/group delivery checks. Both passed required validation and signed tested-tree verification. [Issue64](https://github.com/nathcymru/Tocyn/issues/64) and beta.2 remain incomplete; draft candidates do not establish release readiness.
