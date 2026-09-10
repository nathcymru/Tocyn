# ADR-0023 — Realtime support communications use conversation-linked support sessions

- **Status:** Accepted direction; implementation pending
- **Date:** 10 September 2026

## Context

Tocyn's canonical conversation/channel architecture currently covers message-oriented API/portal/widget and planned external messaging adapters. Rich support requires browser voice/video, screen sharing and PSTN calls, but raw media does not fit naturally into ticket article rows.

Cloudflare Realtime now provides WebRTC SFU primitives intended for custom audio/video/data applications, while RealtimeKit provides higher-level recording/transcription capabilities. PSTN still requires a carrier/telephony provider boundary.

## Decision

Introduce a provider-independent, tenant-scoped `SupportSession` domain linked to a canonical Tocyn conversation.

Tocyn owns:

- support-session identity and lifecycle;
- verified tenant and participant authorisation;
- relationship to canonical conversations;
- media permissions;
- operator/customer UX;
- Durable Object signalling/presence coordination where used;
- cost admission;
- recording/transcription policy;
- audit and retention metadata.

Cloudflare Realtime is the preferred media substrate for the bespoke implementation. The first M8 architecture spike must decide the precise split between raw Realtime SFU and any selective RealtimeKit/media-adapter use before implementation is fixed.

PSTN connectivity is behind a provider-neutral `TelephonyProvider`/gateway. Tenant deployments own their selected provider account, credentials and numbers. Tocyn does not act as a telecom carrier or central number reseller.

A provider session ID, phone number, media track ID or client-supplied room identifier is metadata, not tenant/customer authority.

Screen sharing is in scope; remote desktop control is not included by this ADR.

Recording is policy/consent controlled and is not silently always-on. Recording/transcript artefacts are tenant-owned data with explicit retention and access controls.

Autonomous AI voice agents are out of scope. Post-call bounded transcription/summarisation may use existing AI-assistance rules.

## Consequences

- Native media can evolve without creating a second helpdesk model.
- A text conversation can be upgraded to voice/video and return to text with one history.
- Telephony vendors can change without changing the canonical support model.
- M8 requires explicit media/telephony cost dimensions under the existing CostPolicy architecture.
- Media/substrate capabilities must be revalidated at implementation because Cloudflare/provider APIs are evolving.
- WebRTC must not be described as end-to-end encrypted unless the implemented media path actually provides that property.

## Related

- ADR-0012 — Canonical conversations and channel adapters
- ADR-0014 — Living delivery state
- issue #49
- issues #50, #74, #79, #87, #88, #90
- approved M8.1–M8.4

## Source and current authority

Source archive: `tocyn-product-gap-change-package-2026-09-10.zip`; original path: `tocyn-product-gap-change-package-2026-09-10/adrs/ADR-0017-realtime-support-communications.md`. Source numbering is preserved in the archive; this accepted record uses the master numbering.

Delivery owners: [#142](https://github.com/nathcymru/Tocyn/issues/142), [#143](https://github.com/nathcymru/Tocyn/issues/143), [#144](https://github.com/nathcymru/Tocyn/issues/144), [#145](https://github.com/nathcymru/Tocyn/issues/145), [#146](https://github.com/nathcymru/Tocyn/issues/146), [#147](https://github.com/nathcymru/Tocyn/issues/147), [#148](https://github.com/nathcymru/Tocyn/issues/148).

The [approved master decisions](https://github.com/nathcymru/Tocyn/blob/main/docs/planning/post-beta-2026-09-10/decisions.md) supersede any conflicting source sequencing or release assumption: beta.1 was accepted 9 September and published 10 September 2026 at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full SLA clocks/calendars/pause/resume/waiting treatment and responsible-handler ownership/routing. Independent workspace and hardening foundations proceed in parallel. Existing historical baselines are preserved; milestone taxonomy may evolve to represent dependencies. This ADR grants no remote provisioning, provider activation or customer-traffic authority.
