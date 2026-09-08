# Tocyn repository privacy policy

_Last updated: 8 September 2026_

## Scope

This policy covers personal data processed in connection with the **Tocyn open-source project and its contributor/community touchpoints**. It does not describe the privacy practices of independently deployed Tocyn installations.

The Tocyn project does not currently operate a hosted Tocyn helpdesk service for third parties and does not receive application-level ticket, message, attachment, tenant, knowledge-base or end-user telemetry from independently deployed copies of Tocyn.

This policy applies to information submitted or exposed through:

- the Tocyn GitHub repository, issues/forms, pull requests, Discussions, vulnerability-reporting workflow and other GitHub contribution/feedback surfaces;
- the public Tocyn project-page developer/contact form, where used;
- technical metadata, audit records and anti-abuse/security information that GitHub or the public project-page service providers make available to repository maintainers as part of those interactions.

It does **not** make the Tocyn maintainers the controller for personal data processed solely inside somebody else's Tocyn deployment.

## Project touchpoints and data

### GitHub

If you contribute through GitHub, GitHub may process your account identifier, profile information, IP/device/security metadata and the content/timestamps of issues, pull requests, discussions, commits or security reports under GitHub's own terms and privacy notices. Tocyn maintainers can access only the information GitHub exposes to them through those repository functions.

Public contributions are intentionally public and may remain in Git history even if later edited. Private vulnerability reports should be submitted using the channels in [SECURITY.md](SECURITY.md).

### Public project-page contact form

The project page may collect the fields you choose to submit, currently including name, email address, optional GitHub handle and free-text message. The form is transmitted through Web3Forms and uses hCaptcha/associated browser resources for abuse protection. Those third parties process information under their own terms and privacy practices.

Do not submit tenant data, credentials, vulnerability details, support-ticket exports or other sensitive application data through the public contact form.

### Contributor logs and telemetry

The Tocyn project itself does not intentionally run hidden application telemetry against independent Tocyn deployments. GitHub and other services used to operate the repository may create normal service, security, access and audit logs. Maintainers may see a subset when a provider exposes it for repository administration, abuse response or security work.

## Why project information is used

Repository/community information may be used to:

- review and merge contributions;
- respond to questions, bug reports and feature proposals;
- maintain contributor attribution and licence provenance;
- prevent abuse and investigate repository or supply-chain security concerns;
- respond to lawful requests and enforce project policies;
- maintain the project's public development record.

The appropriate UK GDPR lawful basis, where the UK GDPR applies, depends on the interaction. The project does not claim a single basis for every GitHub or third-party platform activity, and those platform providers may act under their own independent bases.

## Retention

Git history, merged pull requests, issues, release records and other public project history may be retained for the life of the project because preserving provenance, licence attribution, security history and technical decision records is integral to open-source development.

Contact-form messages and private correspondence should be retained only for as long as reasonably needed for the enquiry, project administration, dispute/security evidence or applicable legal obligations. Third-party service providers may apply their own retention periods.

## Independent Tocyn deployments

Tocyn is self-deployed software. A person or organisation that independently deploys Tocyn chooses the infrastructure configuration, users, integrations, retention settings, lawful purposes and data entered into that deployment.

The Tocyn project team:

- does not operate that independent environment merely because the deployer uses this source code;
- does not automatically receive its tenant or end-user data;
- does not determine the deployer's purposes or lawful basis for processing;
- does not provide a representation that installing Tocyn, enabling a feature or using privacy metadata makes a deployment GDPR-compliant.

Independent deployers are responsible for determining their legal role and obligations. In the ordinary case where a deployer decides why and how its helpdesk processes personal data, it will normally be acting as a data controller for that processing. Contractual or other arrangements can alter legal roles, so deployers must make their own assessment and obtain professional advice where appropriate.

The software is provided under the [MIT licence](LICENSE), including its **"AS IS"** warranty disclaimer. The licence does not remove legal obligations that apply to a deployer's own processing activities.

## FidesLang and privacy metadata

Tocyn's approved roadmap includes future FidesLang-based privacy metadata work under issues [#16](https://github.com/nathcymru/Tocyn/issues/16) and [#17](https://github.com/nathcymru/Tocyn/issues/17). **The inspected `main` branch does not yet contain those FidesLang declarations.**

When implemented, that metadata is intended to describe data categories, data subjects and data uses in a machine-readable form. It is not an access-control system, does not override tenant isolation, and does not transfer the deployer's compliance responsibility to the Tocyn project.

See the technical [PRIVACY_ARCHITECTURE Wiki page](https://github.com/nathcymru/Tocyn/wiki/PRIVACY_ARCHITECTURE) and repository source at [`docs/privacy/privacy-architecture.md`](docs/privacy/privacy-architecture.md).

## Your project-touchpoint rights

If data-protection law gives you rights in relation to information controlled by the Tocyn project itself, you may contact the project through the non-sensitive contact mechanism on the public project page or the relevant GitHub interaction. Requests relating to data controlled independently by GitHub, Web3Forms, hCaptcha/Google or another provider may need to be directed to that provider.

For security vulnerabilities, use [SECURITY.md](SECURITY.md), not a privacy-rights request or public issue.

## Changes

This policy may be updated as repository/community services change. It does not silently extend to independently deployed Tocyn applications; any future hosted service operated by the Tocyn project would require its own applicable privacy information before processing customer application data.
