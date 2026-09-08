![Tocyn Banner](https://raw.githubusercontent.com/nathcymru/Tocyn/main/public/assets/brand/tocyn-github-repo-header.webp)

# Tocyn

[![License: MIT](https://shieldcn.dev/github/license/nathcymru/Tocyn.svg)](LICENSE)
[![Cloudflare Workers](https://shieldcn.dev/badge/Cloudflare-Workers-F38020.svg?logo=cloudflare)](https://github.com/nathcymru/Tocyn/wiki/Architecture-and-tenant-isolation)
[![CI](https://shieldcn.dev/github/ci/nathcymru/Tocyn.svg)](https://github.com/nathcymru/Tocyn/actions/workflows/ci.yml)
[![CodeQL enabled](https://shieldcn.dev/badge/CodeQL-enabled-2088FF.svg?logo=github)](https://github.com/nathcymru/Tocyn/security/code-scanning)

Tocyn (Welsh for “ticket”) is an open-source helpdesk being developed as a multi-tenant application on the Cloudflare serverless edge. It is a fork of [Luminatick by 05ng](https://github.com/05ng/luminatick) and retains the original MIT attribution.

**Status: early development; no stable release yet.** Phase 1 application-enforced tenant isolation has been implemented and source-review acceptance completed, while isolated deployment/beta verification and production cutover remain separate gates.

## Current direction

Tocyn has working API and portal foundations, operator interfaces, ticketing, knowledge/AI assistance and Cloudflare-backed services. The approved roadmap now separates architectural capability milestones (`M0.x`–`M7.x`) from software releases.

The first planned release boundary is a **human-led API/portal private beta**, currently forecast for **21 November 2026** with candidate prerelease `v0.4.0-beta.1`. Slack, support email and autonomous resolution follow as independent roadmap capabilities; they do not block the first beta.

See the [approved architectural roadmap](https://github.com/nathcymru/Tocyn/wiki/Approved-architectural-roadmap), [issues](https://github.com/nathcymru/Tocyn/issues) and [roadmap summary](docs/roadmap.md).

## Architecture

The application targets Cloudflare Workers, D1, R2, Durable Objects, Workers AI, Vectorize and related edge services. Cost/capacity limits, tenant isolation and failure recovery are explicit roadmap concerns; no statement here is a production-readiness declaration.

Authentication/transactional mail currently uses an injectable transport with Resend retained for the first isolated beta. Cloudflare-native transactional mail migration and full helpdesk support-email conversations are separate roadmap items.

## Repository guide

- [Contributing](CONTRIBUTING.md)
- [Documentation index](docs/README.md)
- [Agent governance](docs/agents/README.md)
- [Repository structure](docs/repository-structure.md)
- [Security policy](SECURITY.md)
- [Community standards](CODE_OF_CONDUCT.md)
- [Application icons](public/app_icons/README.md)

Use development resources and synthetic data. Remote deployment, provider activation, production migrations, tags and releases require their own approved gates.

## Roadmap model

| Phase | Focus |
| --- | --- |
| M0 | Engineering, cost/capacity and delivery environments |
| M1 | Core data and intake |
| M2 | Human workspace |
| M3 | AI enrichment |
| M4 | Policy-gated autonomous resolution |
| M5 | Governance and oversight |
| M6 | Service-user experience |
| M7 | Channel integrations |

Milestones answer **what capability are we completing?** Releases answer **what tested source snapshot can people use?** The `beta-blocker` label independently answers **what prevents the next beta?**

## Help build Tocyn

Contributions to documentation, testing, accessibility, security and implementation are welcome. Start with a clearly scoped issue and coordinate before substantial work.

- [Questions and ideas](https://github.com/nathcymru/Tocyn/discussions)
- [Report a non-security bug](https://github.com/nathcymru/Tocyn/issues/new/choose)
- [Report a vulnerability privately](SECURITY.md)

## Licence and acknowledgement

Tocyn is released under the [MIT licence](LICENSE). The original Luminatick copyright and permission notice are retained.

Cloudflare and related product names are trademarks of Cloudflare, Inc. Tocyn is an independent open-source project and is not affiliated with, endorsed by or sponsored by Cloudflare, Inc.
