# Start here

## What Tocyn is

Tocyn is being built as an omnichannel, multi-tenant helpdesk: service users contact support through a portal, embedded widget, programmatic API or external channel, while human operators work in one canonical conversation workspace. Bounded AI assistance and governed autonomous workflows extend that shared model; they do not create a separate helpdesk or bypass human control. The approved design combines shared headless dashboard/portal/widget UI, verified support-email/Slack/Teams/WhatsApp/Telegram adapters, distinct ingress/consumer/dispatch responsibilities and tenant-scoped Cloudflare state. See [[System-architecture]] for the target diagram and current implementation status.

It is a fork of Luminatick, but Tocyn's current roadmap, tenant model and governance are maintained independently in this repository.

## What works today

Current source includes core authentication/permissions, tickets/conversations, portal/API/widget paths, knowledge/AI-assistance foundations, tenant-qualified ownership, R2-backed attachments/offloaded bodies, real-time Durable Object coordination and email transport foundations.

## What is still planned

The roadmap includes isolated beta/prod environments, Slack and other external channels, support-email expansion, deeper operator UX, measurable FidesLang privacy metadata, policy-gated autonomous backend actions and production-readiness work.

Do not interpret roadmap pages as claims that those capabilities are deployed.

## Recommended reading order

1. [[Post-beta-master-baseline]] and [[System-architecture]]
2. [[Architecture-and-tenant-isolation]]
3. [[Roadmap-and-releases]] and [[Approved-architectural-roadmap]]
4. [[Channels-and-conversation-model]]
5. [[AI-and-autonomous-operations]]
6. [[PRIVACY_ARCHITECTURE]]
7. [[Architecture-decision-records]]
8. [Agent handover](https://github.com/nathcymru/Tocyn/blob/main/docs/planning/post-beta-2026-09-10/handover.md)

For contribution/security/privacy policy, also read the repository `CONTRIBUTING.md`, `AGENTS.md`, `SECURITY.md` and `PRIVACY_POLICY.md`.
