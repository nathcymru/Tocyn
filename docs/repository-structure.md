# Repository structure

Tocyn keeps GitHub-standard community files at the repository root because GitHub and contributors discover them there: `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` and `AGENTS.md`.

Primary directories:

- `apps/` — application workspaces; not reorganised by repository housekeeping.
- `packages/` — shared runtime packages.
- `public/` — public project/application assets, including `app_icons/` and `assets/brand/`.
- `docs/` — architecture, operational, security and historical implementation documentation.
- `.agents/` — vendor-neutral AI agent governance/playbooks/resources/state rules.
- `.github/` — GitHub-native templates, workflows and Copilot compatibility instructions.
- `tools/` — development-only tooling.
- `scripts/` — repository/application utility scripts.

## GitHub Pages compatibility

The public project page is currently served from the repository root. Therefore root `index.html` and the three image files it directly references are retained as compatibility assets until the Pages source is deliberately migrated and verified. Canonical copies also live under `public/assets/brand/`.

The README-only repository banner is stored canonically under `public/assets/brand/`; it does not need a duplicate root copy.

Do not move application source or historical documentation merely for cosmetic consistency. Moves must preserve links, tooling, Pages behaviour and historical evidence.
