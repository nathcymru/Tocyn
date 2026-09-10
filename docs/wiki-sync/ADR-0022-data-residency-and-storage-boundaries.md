# ADR-0022 — Deployment residency and jurisdiction boundaries

- **Status:** Accepted direction; implementation pending
- **Date:** 10 September 2026
- **Decision owner:** Tocyn maintainer approval,10September2026
- **Issue:** `[NEW-#160]`


## Context

Tocyn is an independently deployable, multi-tenant Cloudflare helpdesk. Its data is spread across several classes of service:

- D1 relational state;
- R2 attachments/offloaded bodies/raw envelopes;
- Durable Objects for realtime and future budget coordination;
- Vectorize derived knowledge vectors;
- Workers AI;
- future Cloudflare Queues;
- Worker/Queue/Workflow/Cron execution;
- operational logs/traces;
- external providers such as mail/messaging systems.

A single `tenant.jurisdiction` field cannot make all of these services process data in one region.

Cloudflare currently offers jurisdiction controls for some stateful services, but the exact coverage and semantics differ. Some settings are immutable at resource creation. Regional Services can constrain HTTP Worker execution for configured custom domains, but does not automatically constrain Queue or Cron-trigger execution.

Tocyn therefore needs to define exactly what it can claim before a deployer or tenant UI exposes a residency promise.

## Decision

### 1. Residency is a deployment capability, not tenant routing authority

Tocyn will not allow an ordinary request payload, path field, user profile or tenant setting to select a data jurisdiction.

A deployment may declare a verified residency policy based on the actual Cloudflare resources and features provisioned for that deployment.

Tenant administration may restrict use of features within that deployment but cannot expand the deployment's locality guarantee.

### 2. Mixed hard-residency tenants use separate deployments

For v1, if tenants require incompatible hard residency guarantees, the supported architecture is separate deployments/resources rather than dynamically moving individual tenant operations across shared D1/R2/DO/Vectorize infrastructure.

This preserves tenant isolation and makes resource/locality evidence auditable.

### 3. Storage and processing claims are separate

Tocyn documentation/configuration must distinguish:

- storage jurisdiction;
- request-processing jurisdiction;
- asynchronous-trigger execution;
- derived/vector/AI processing;
- provider processing;
- observability/log metadata location.

A storage-constrained deployment must not be described as an end-to-end processing-resident deployment unless every material path is verified.

### 4. Capability matrix

Provisioning/readiness evidence records each material component as:

- guaranteed;
- best-effort;
- unrestricted;
- unsupported;
- unknown/not yet verified.

Unknown is not converted into a guarantee.

### 5. Immutable resource decisions

Where a Cloudflare service requires jurisdiction at resource creation, Tocyn's provisioning workflow must:

- resolve the deployment policy before creation;
- create the correct jurisdiction-specific resource;
- record the jurisdiction in the deployment manifest;
- verify the live resource/binding;
- fail rather than silently provision an unrestricted substitute;
- require migration/re-provisioning when an existing resource cannot be converted in place.

### 6. Current capability caution

As of this ADR's review date:

- D1 documents jurisdiction-constrained database creation;
- R2 documents jurisdictional restrictions and jurisdiction-aware Worker bindings;
- Durable Objects document jurisdiction subnamespaces;
- Vectorize is documented as a globally distributed vector database and no equivalent per-index jurisdiction control was identified in the reviewed documentation;
- Workers AI data-use protections do not themselves establish a Tocyn processing-location guarantee;
- Regional Services does not apply to Queue/Cron triggers;
- observability metadata locality depends on separate Cloudflare/account features.

These facts must be reverified at implementation/provisioning time.

### 7. Strict locality feature handling

If a requested locality guarantee is incompatible with a required Tocyn service, policy must explicitly:

- deny the unsupported deployment profile;
- disable the incompatible feature; or
- state a narrower truthful guarantee.

Silent downgrade is prohibited.

## Consequences

- no false “EU resident” claim arises from only moving a Durable Object;
- residency settings cannot become a tenant-authority bypass;
- deployments requiring stronger locality may have fewer features or separate infrastructure;
- provisioning must occur from an explicit manifest;
- switching an existing deployment to a hard jurisdiction may require migration/new resources;
- privacy/compliance docs can distinguish architecture capability from legal compliance.

## Rejected alternatives

### Per-tenant jurisdiction field inside one shared deployment

Rejected for v1. It implies a uniformity of D1/R2/Vectorize/AI/Queue processing that the shared architecture cannot guarantee merely from an application field.

### Use Durable Object jurisdiction as the global residency control

Rejected. DO jurisdiction controls the object, not every Worker/storage/AI/Queue/log path.

### Claim GDPR compliance from EU storage

Rejected. Residency is only one technical property and is not a legal-compliance conclusion.

## Related

- #42 — production readiness
- #57 — future remote environment/provisioning
- #19 — tenant isolation
- #50/#64 — resource/capacity governance
- ADR-0015 — privacy metadata is not access-control authority
- `docs/privacy/privacy-architecture.md`
- `docs/architecture/data-and-tenant-boundaries.md`

## Source and current authority

Source archive: `tocyn-gap-analysis-2-change-package-2026-09-10.zip`; original path: `tocyn-gap-analysis-2-change-package-2026-09-10/adr-drafts/ADR-0017-deployment-residency-and-jurisdiction-boundaries.md`. Source numbering is preserved in the archive; this accepted record uses the master numbering.

Delivery owners: [#160](https://github.com/nathcymru/Tocyn/issues/160).

The [approved master decisions](https://github.com/nathcymru/Tocyn/blob/main/docs/planning/post-beta-2026-09-10/decisions.md) supersede any conflicting source sequencing or release assumption: beta.1 was accepted 9 September and published 10 September 2026 at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full SLA clocks/calendars/pause/resume/waiting treatment and responsible-handler ownership/routing. Independent workspace and hardening foundations proceed in parallel. Existing historical baselines are preserved; milestone taxonomy may evolve to represent dependencies. This ADR grants no remote provisioning, provider activation or customer-traffic authority.

## Residency source validation (#160)

The [deployment residency contract](https://github.com/nathcymru/Tocyn/blob/main/docs/deployment-residency.md) and preview/beta manifests now distinguish storage, HTTP, asynchronous, AI/provider and observability paths. Local release preparation validates these fields and carries them into its binding manifest. Current evidence is pending/unknown; no live jurisdiction guarantee or legal compliance is claimed. The current generator rejects hard profiles because its bindings do not implement jurisdiction-aware provisioning. Production #42 and future remote #57 must verify resource creation-time jurisdiction, processing paths and migration consequences before any constrained deployment. Tenant/request metadata cannot select a deployment region.
