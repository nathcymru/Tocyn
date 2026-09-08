# Repository structure

Tocyn keeps GitHub-standard community/policy files at repository root because GitHub and contributors discover them there: `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `PRIVACY_POLICY.md`, `CODE_OF_CONDUCT.md` and `AGENTS.md`.

Primary directories:

- `apps/` — application workspaces; not reorganised by repository housekeeping.
- `packages/` — shared runtime packages.
- `public/` — canonical public project/application assets, including `app_icons/` and `assets/brand/`.
- `docs/` — architecture, privacy, ADR, operational, security and historical documentation.
- `.agents/` — vendor-neutral AI-agent governance/playbooks/resources/state rules.
- `.github/` — GitHub-native templates, workflows and Copilot compatibility instructions.
- `tools/` — development-only tooling.
- `scripts/` — repository/application utility scripts.

## GitHub Pages project page

The public project information page remains `index.html` at repository root because GitHub Pages currently serves that source. Its images reference the canonical `public/assets/brand/` files directly; loose duplicate root image files are not required.

The Pages site is documentation/community infrastructure, not the Tocyn application and not evidence that a hosted Tocyn helpdesk exists.

## Wiki source

GitHub Wiki is a separate Git repository. Reviewed Wiki publication source is retained under `docs/wiki-sync/` so architecture/privacy changes can be reviewed in normal pull requests before a Wiki-capable agent synchronizes the live Wiki while preserving history.

## Move policy

Do not move application source or historical documentation merely for cosmetic consistency. Moves must preserve links, tooling, Pages behaviour and historical evidence. Search both repository content and `docs/wiki-sync/` for affected references before moving public assets or documentation.
