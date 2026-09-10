# GitHub Wiki synchronization bundle

This directory contains reviewed, repository-backed source for the Tocyn GitHub Wiki. The GitHub Wiki is a separate Git repository. This alignment read it directly using the authenticated Git route; reviewed source publication and byte comparison are required before #126 acceptance.

## Publication rule

A Wiki-capable agent must **clone/read the current live Wiki first** and preserve historical pages/ADRs that are not represented here. Do not replace ADR-0001–ADR-0009 or the 8 September backlog-migration receipt from memory.

For pages in this directory:

- use these files as the current replacement content where the same page exists;
- create the page where it is missing;
- preserve historical-only pages and link them from the appropriate current page rather than deleting them;
- apply `_Sidebar.md` to make current architecture/privacy/roadmap navigation obvious;
- verify every internal Wiki link after publication.

## Pages in this bundle

- `Home.md`
- `Start-here.md`
- `_Sidebar.md`
- `System-architecture.md`
- `Architecture-and-tenant-isolation.md`
- `Channels-and-conversation-model.md`
- `AI-and-autonomous-operations.md`
- `Knowledge-marker-contract.md` (accepted source: `docs/security/knowledge-marker-contract.md`, PR172)
- `PRIVACY_ARCHITECTURE.md`
- `GDPR_COMPLIANCE_USER_GUIDE.md`
- `Roadmap-and-releases.md`
- `Architecture-decision-records-addendum.md`

New ADR source lives under `docs/adr/` and should be copied to Wiki pages with the same ADR number/title.

## Migration-owned pages

The following known pages were created/updated during the approved backlog migration and must be read before changing them:

- `Approved-architectural-roadmap`
- `Backlog-migration-2026-09-08`
- `Omnichannel-implementation-roadmap`
- `Deployment-and-operating-costs`
- `Architecture-decision-records`
- `ADR-0010-Policy-gated-actions-and-reference-validation`
- `ADR-0011-Architectural-milestones-and-private-beta`

This bundle supplements/reconciles them; it does not authorise destroying their historical evidence.

The post-beta master page and ADR-0016–0028 are part of this bundle. Historical roadmap copies are marked superseded and are excluded from active navigation. `README.md` is repository publication guidance, not a live Wiki page.
