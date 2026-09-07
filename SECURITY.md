# Security policy

## Supported development versions

Tocyn is pre-release software. Security reports are accepted for the current `main` branch and the latest Tocyn pre-release once published. There is no released 1.x support line. Older snapshots are not separately maintained; fixes normally target current development.

This policy does not assert that multi-tenant isolation or a full security audit is complete.

## Report privately

Please use [GitHub private vulnerability reporting](https://github.com/nathcymru/Tocyn/security/advisories/new). Do not put vulnerabilities, exploit details, credentials or customer information in public issues or discussions.

If GitHub's reporting form is unavailable, you may try the contact form on the [public project page](https://nathcymru.github.io/Tocyn/) to request a secure reporting channel. This is a best-effort fallback whose availability has not yet been verified. Send only a non-sensitive contact request through this third-party form service. Alternatively, open a public issue titled "Request for security contact channel" containing only a request to establish private contact: do not include vulnerability details, affected systems, credentials or personal contact information.

Include the affected commit or version, impact, reproduction steps using synthetic data, and a minimal proof of concept. Test only systems you own or have permission to test.

We aim to acknowledge reports within 48 hours, subject to maintainer availability; this is a response target, not a service-level guarantee. We will coordinate triage, remediation, disclosure and credit with the reporter.

## Scope

Reports may concern authentication, authorisation, tenant boundaries, database access, object storage, attachment handling, real-time events, email, API keys, AI retrieval, dependencies, build tooling or deployment configuration.

Assess Node.js-related findings against the component and runtime affected; they are not categorically excluded. Potential cross-tenant disclosure receives urgent investigation. Severity depends on demonstrated impact.

FidesLang metadata does not replace access controls. Disabling optional end-user privacy tooling must never disable tenant isolation or security controls.
