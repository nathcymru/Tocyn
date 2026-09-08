![Tocyn repository banner](public/assets/brand/tocyn-github-repo-header.webp)

# Tocyn

**Tocyn** (Welsh for “ticket”, pronounced roughly “Tock-in”) is an open-source, multi-tenant helpdesk/support system built for Cloudflare's edge application stack. It is a fork of [Luminatick](https://github.com/05ng/luminatick) and is released under the MIT licence.

> **Pre-release:** Tocyn has no stable release and no project-operated hosted helpdesk service. Current source is under active development. Do not treat the repository, roadmap or documentation as evidence of production readiness.

## Current status

The repository currently contains:

- a Hono/Cloudflare Worker API backend;
- operator dashboard, customer portal and embeddable widget applications;
- authentication, permissions, ticket/conversation and knowledge-base foundations;
- D1-backed application state;
- R2-backed attachment/offloaded-body storage;
- tenant-keyed Durable Object real-time coordination;
- Workers AI + Vectorize knowledge/AI-assistance foundations;
- an injectable email transport with Resend configuration;
- Phase 1 application-enforced tenant ownership/isolation changes in source.

The first planned test outcome is a **human-led API/portal private beta**, forecast for **21 November 2026**, candidate `v0.4.0-beta.1`. That prerelease has not been created. Slack, support-email expansion and governed autonomous customer-backend actions follow in later roadmap work.

The approved roadmap distinguishes **implemented source**, **beta/environment validation**, and **production readiness**. A feature appearing in an issue or architecture document does not mean it is already deployed.

## How Tocyn fits together

```mermaid
flowchart LR
  UI[Dashboard / Portal / Widget / API]
  W[Cloudflare Worker API]
  D1[(D1)]
  R2[(R2)]
  DO[Durable Object]
  AI[Workers AI]
  VX[(Vectorize)]

  UI --> W
  W --> D1
  W --> R2
  W --> DO
  W --> AI
  W --> VX
```

The diagram is an arrangement overview. In prose: browser/API surfaces call a Hono Worker; the Worker uses D1 for relational state, R2 for file/offloaded content, a tenant-keyed Durable Object for real-time operator coordination, and Workers AI/Vectorize for knowledge/AI-assistance functions. Tenant authority is derived from authenticated/verified scope before tenant-owned data is accessed.

Current `apps/server/wrangler.json` does **not** define Cloudflare Queue or Cloudflare Calls bindings, so documentation does not claim those services are already active. Provider integrations such as Slack, Teams, WhatsApp and Telegram remain planned adapter work.

Read the detailed [system architecture](docs/architecture/system-overview.md).

## Multi-tenancy and security

Tocyn's core invariant is that a tenant ID supplied in a URL, payload, webhook or automation rule is **not authority**. Request-driven data/storage operations must use a verified tenant scope and scoped repositories/storage adapters.

Phase 1 migrations qualify core ownership records by tenant, including users, groups, tickets, articles, attachments, memberships and support-email configuration. R2/Vectorize side effects are also treated as tenant-owned derived/external state rather than being authorised by raw object/vector identifiers.

See:

- [Data and tenant boundaries](docs/architecture/data-and-tenant-boundaries.md)
- [Security policy](SECURITY.md)
- [Multitenancy implementation/review evidence](docs/architecture/multitenancy/)

Please report vulnerabilities privately under [SECURITY.md](SECURITY.md).

## Channels and conversations

Tocyn uses a canonical ticket/conversation model. External providers are intended to be adapters around that core rather than separate helpdesk implementations.

Current beta sequencing is intentionally conservative:

1. prove API/portal canonical conversations and human operation;
2. add shared adapter/dispatch infrastructure and Slack;
3. expand support email and other approved external channels;
4. introduce governed autonomous resolution only after the human fallback, policy gate and audit controls are proven.

See [Channel adapter architecture](docs/architecture/channel-adapters.md).

## AI and autonomous operations

Current AI facilities are advisory/knowledge-oriented: embeddings, knowledge-grounded responses and suggested replies. Tocyn does **not** currently give AI standing authority over customer backend systems.

Approved future autonomous actions are policy-gated:

`deployment-owner authority ceiling → tenant restriction → runtime policy → allow / human approval / deny`

The first write-capability proof will use an isolated reference API before any real customer backend becomes a dependency. See [AI and autonomous operations](docs/architecture/ai-and-autonomous-operations.md).

## Privacy engineering

The Tocyn project does not operate a hosted customer helpdesk and does not automatically receive application-level data from independent Tocyn deployments. Repository/community touchpoints are covered by [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

The roadmap includes future FidesLang privacy-as-code metadata under issues #16/#17. **FidesLang declarations are not yet present in the inspected `main` branch.** When implemented, the metadata is intended to describe data categories/subjects/uses for privacy tooling; it will not replace authentication, authorisation or tenant isolation.

Technical privacy documentation:

- [Privacy architecture](docs/privacy/privacy-architecture.md)
- [GDPR deployer technical guide](docs/privacy/gdpr-compliance-user-guide.md)

Using Tocyn or future FidesLang metadata does not by itself make a deployment GDPR-compliant. Independent deployers remain responsible for their own legal roles, configurations, processing purposes, retention, notices, contracts and operational compliance.

## Repository layout

```text
apps/                 Application workspaces
packages/             Shared runtime packages
public/               Public assets and application icon package
docs/                 Architecture, privacy, security and operational docs
.agents/              Vendor-neutral agent skills/workflows/resources/state
.github/               GitHub workflows/templates/Copilot shim
tools/                 Development tooling
scripts/               Utility scripts
```

GitHub-standard files such as `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `PRIVACY_POLICY.md` and `AGENTS.md` intentionally remain at repository root.

See [Repository structure](docs/repository-structure.md) and [Documentation index](docs/README.md).

## Application icons and brand assets

- canonical public brand assets: [`public/assets/brand/`](public/assets/brand/)
- platform application icon package: [`public/app_icons/`](public/app_icons/)

Do not reintroduce loose root image copies solely for README/Page compatibility; repository references should use the canonical public asset paths.

## Development

This is a pnpm workspace. Start with the current repository instructions rather than historical phase documents.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md) for contribution and coding-agent governance. Repository work is issue-owned, PR-delivered, and uses persistent progress/completion receipts so the roadmap remains a living record.

## Roadmap

Current architectural milestones are capability-based rather than version-based:

| Phase | Focus |
| --- | --- |
| M0 | Engineering, platform/cost controls and delivery environments |
| M1 | Core data, intake, ticket-feed validation and transactional mail |
| M2 | Human workspace, composer/productivity, real-time state and design system |
| M3 | Context aggregation, triage/summarisation and operator AI assistance |
| M4 | Tool boundaries, governed autonomous resolution and human handoff |
| M5 | Authorisation, audit/oversight, analytics, privacy metadata and workflow administration |
| M6 | Portal/service-user experience, SLA, cross-channel continuity and deterministic self-service |
| M7 | WhatsApp, Telegram, Slack, Teams and support-email integrations |

Milestones describe architecture/capability completion. Releases are separate Git tags/GitHub Releases. `beta-blocker` is a cross-cutting readiness label rather than a milestone.

- [Approved architectural roadmap](https://github.com/nathcymru/Tocyn/wiki/Approved-architectural-roadmap)
- [Repository roadmap pointer](docs/roadmap.md)
- [Architecture decision records](docs/adr/README.md)

## Public project page

The repository's GitHub Pages project page is: https://nathcymru.github.io/Tocyn/

It is a project/contributor information surface, **not** a hosted Tocyn application. Do not submit credentials, customer/tenant data or vulnerability details through its public contact form.

## Licence and upstream attribution

Tocyn is provided under the [MIT License](LICENSE), including its “AS IS” warranty disclaimer. The upstream Luminatick attribution/licence history is preserved in the repository.

Tocyn is an independent open-source project and is not affiliated with or endorsed by Cloudflare, GitHub, Ethyca/Fides or the external channel providers referenced by its roadmap.
