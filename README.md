![Tocyn Banner](tocyn_github_repo_header.webp)

# Tocyn

[![License: MIT](https://shieldcn.dev/github/license/nathcymru/Tocyn.svg)](LICENSE)
[![CI](https://github.com/nathcymru/Tocyn/actions/workflows/ci.yml/badge.svg)](https://github.com/nathcymru/Tocyn/actions/workflows/ci.yml)

Tocyn (Welsh for "ticket") is an open-source helpdesk being developed into a feature-rich, multi-tenant application on the Cloudflare serverless edge.

**Status: early development.** The inherited application provides the starting point. Multi-tenancy and the roadmap below are development targets, not a claim that tenant isolation has been independently verified. There is no stable Tocyn release yet.

Tocyn is a fork of [Luminatick by 05ng](https://github.com/05ng/luminatick), retained under the MIT licence with the original copyright notice.

## What is here today?

| Area | Status |
| --- | --- |
| Agent dashboard, customer portal and web widget | Inherited implementation; validation and improvement are ongoing |
| Tickets, email, API keys, knowledge base and AI assistance | Inherited implementation; see the code and existing deployment documentation |
| Multi-tenant operation | Tocyn development direction; requires a reviewed isolation model and regression tests |
| FidesLang privacy metadata and optional end-user capabilities | Planned across v0.1.0 and v0.2.0 |
| Cloudflare-native outbound email replacing Resend | Target v0.3.0 |
| Queues-based processing, audio/video, Signal and remote-support integrations | Roadmap ideas; not advertised as delivered features |

## Architecture and operating model

The application targets a **Cloudflare-only hosting and native-service architecture**: Workers, D1, R2, Durable Objects, Workers AI, Vectorize and Workflows form the inherited foundation. Additional services will be introduced as their features are implemented and verified.

The aim is a low-cost, free-tier-conscious helpdesk without servers to administer. Operating costs depend on enabled services, usage and provider allowances; application security and dependency updates still require maintenance.

The inherited application currently uses Resend for outbound email. Replacing it with Cloudflare-native email is a v0.3.0 target. The standalone public project page uses Web3Forms to let visitors contact the maintainer without publishing personal contact details; that page is separate from the helpdesk application.

## Get started

Read [Contributing](CONTRIBUTING.md) for the development commands and current setup caveats. The inherited [deployment guide](docs/deployment.md) describes the existing provisioning process; names and external email requirements there have not yet been migrated to the target architecture.

Use a development account and synthetic data while evaluating this pre-release code. A clean-checkout setup verification is part of the foundation backlog.

## Roadmap

| Milestone | Goal |
| --- | --- |
| v0.1.0 | Repository and security foundations, agreed coding standards, FidesLang across the majority of applicable application code |
| v0.2.0 | Whole-codebase FidesLang review and coverage of all applicable areas, with optional end-user functionality |
| v0.3.0 | Replace Resend with Cloudflare-native email and document migration |

See the [detailed roadmap](docs/roadmap.md) and [issues](https://github.com/nathcymru/Tocyn/issues). Milestones describe intended outcomes, not release dates or completed work.

## Help build Tocyn

Contributions to documentation, testing, accessibility, security and implementation are welcome. Start with an issue that has a clear scope; comment before substantial work so we can coordinate with work already in progress.

- [Contributor guide](CONTRIBUTING.md)
- [Questions and ideas](https://github.com/nathcymru/Tocyn/discussions)
- [Report a non-security bug](https://github.com/nathcymru/Tocyn/issues/new/choose)
- [Report a vulnerability privately](SECURITY.md)
- [Community standards](CODE_OF_CONDUCT.md)

## Licence and acknowledgement

Tocyn is released under the [MIT licence](LICENSE). The original Luminatick copyright and permission notice are retained alongside the Tocyn notice.

Cloudflare and related product names are trademarks of Cloudflare, Inc. Tocyn is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Cloudflare, Inc.
