# ADR-0026 — Cloudflare Access authenticates workforce entry; Tocyn authorises application capabilities

- **Status:** Accepted direction; implementation pending
- **Date:** 10 September 2026

## Context

Enterprise helpdesks commonly expose SAML/OIDC/Google SSO and SCIM/JIT features. Tocyn is Cloudflare-native and is intended to integrate into the deployment owner's Cloudflare Zero Trust security policy rather than duplicate an identity-provider integration suite.

Cloudflare Access can sit in front of Workers/applications and supply a signed Access JWT. Tocyn still needs to verify that assertion and map it to an application actor.

## Decision

Tocyn will support a `cloudflare_access` workforce authentication mode for operator/admin access.

In that mode:

- Cloudflare Access is the upstream workforce authentication gate;
- Tocyn verifies `Cf-Access-Jwt-Assertion` cryptographically, including issuer and application audience;
- a verified Access identity must resolve through an explicit Tocyn workforce mapping;
- automatic JIT Tocyn-user creation is disabled by default;
- external/group claims do not directly grant Tocyn capabilities;
- #79 Tocyn capabilities remain authoritative after authentication.

Tocyn will not implement native SAML, OIDC, Google SSO or SCIM endpoints merely for competitor parity. Deployers may configure those identity providers and lifecycle controls in Cloudflare Access.

Customer/service-user authentication remains a separate product boundary and is not automatically placed behind the deployment owner's workforce Access policy.

A local/bootstrap development mode may remain, but production `cloudflare_access` mode must not expose it as an authentication bypass.

## Consequences

- Enterprise IdP diversity is delegated to the Cloudflare stack.
- Tocyn's application permission model remains provider-independent.
- Deployment documentation must clearly distinguish Cloudflare Access policy from Tocyn roles/capabilities.
- Access JWT key rotation/audience validation becomes a tested runtime responsibility.
- A deployment without correctly configured Access cannot claim this enterprise workforce-auth posture.
- No SCIM/JIT feature should appear in Tocyn product claims unless separately implemented.

## Related

- issue #79
- Cloudflare Access documentation
- approved M9.5

## Source and current authority

Source archive: `tocyn-product-gap-change-package-2026-09-10.zip`; original path: `tocyn-product-gap-change-package-2026-09-10/adrs/ADR-0020-cloudflare-access-workforce-identity.md`. Source numbering is preserved in the archive; this accepted record uses the master numbering.

Delivery owners: [#158](https://github.com/nathcymru/Tocyn/issues/158).

The [approved master decisions](https://github.com/nathcymru/Tocyn/blob/main/docs/planning/post-beta-2026-09-10/decisions.md) supersede any conflicting source sequencing or release assumption: beta.1 was accepted 9 September and published 10 September 2026 at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full SLA clocks/calendars/pause/resume/waiting treatment and responsible-handler ownership/routing. Independent workspace and hardening foundations proceed in parallel. Existing historical baselines are preserved; milestone taxonomy may evolve to represent dependencies. This ADR grants no remote provisioning, provider activation or customer-traffic authority.
