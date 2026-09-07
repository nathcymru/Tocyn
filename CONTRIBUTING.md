# Contributing to Tocyn

Tocyn is an early-stage MIT-licensed fork of Luminatick, developing a multi-tenant helpdesk on Cloudflare. Documentation, testing, accessibility and security contributions are as valuable as feature code.

## Find work and coordinate

Read the [roadmap](docs/roadmap.md). Use Discussions for questions and proposals, and issues for agreed work and reproducible bugs. Comment on an issue before a substantial change to avoid overlapping another contributor or agent. Small corrections can be proposed directly.

Describe the intended behaviour and acceptance criteria before large architectural changes. Follow the [code of conduct](CODE_OF_CONDUCT.md); report security concerns through [SECURITY.md](SECURITY.md).

## Development setup

Use Node.js 22.12 or newer in the Node 22 line and npm. The repository is an npm workspace with a root lockfile.

```bash
git clone https://github.com/nathcymru/Tocyn.git
cd Tocyn
npm ci
npm run db:migrate:local
npm run dev:server
```

In separate terminals, start the interfaces you need:

```bash
npm run dev:dashboard
npm run dev:portal
```

Inspect `.env.example` and `apps/server/.dev.vars.example` for configuration. Use local untracked configuration and synthetic test data. Some existing AI/Vectorize bindings use remote services: local development does not guarantee an entirely offline or cost-free run. The clean-checkout verification issue tracks remaining setup gaps.

The inherited [deployment guide](docs/deployment.md) covers provisioning. Commands containing `:prod`, `--remote`, or `deploy` affect Cloudflare resources and are not required for an ordinary documentation contribution.

## Checks

```bash
npm run lint --workspace=apps/portal
npm run typecheck --workspace=apps/server
npm run build --workspace=apps/dashboard
npm run build --workspace=apps/portal
npm run build --workspace=apps/widget
npm run test --workspace=apps/server -- --run
npm exec --workspace=apps/portal -- vitest run src/__tests__/VerifyPage.test.tsx
```

Portal linting is the current lint coverage, not a claim of repository-wide linting. CI explicitly runs the server tests and portal verification-flow regression tests; extending the remaining frontend test coverage is tracked separately. Report pre-existing failures instead of suppressing them.

## Pull requests

Fork the repository or use a dedicated branch. Open the PR against Tocyn's `main`. Explain the problem, change and evidence of validation. Include screenshots for visible changes and tests for meaningful behavioural changes.

Keep formatting-only changes separate from functional work. Follow nearby conventions until the coding-standard issue selects and configures the formatter and lint rules. Prettier is under consideration, not yet a mandatory dependency.

The default branch requires verified commits; feature branches may contain unsigned commits. All changes go through a PR with passing checks and a verified final commit. GitHub may restrict squash merges of another author's PR into a signed branch; coordinate the verified merge path with the maintainer. Repository administrators have a PR-only review exception for solo-maintainer work; this does not bypass CI, signatures or main integrity.

Do not commit credentials, personal data or production exports. AI-assisted contributions are welcome when the contributor understands the change, verifies it, preserves attribution and remains responsible for its correctness. Use synthetic examples with development AI tools.

## Privacy and tenancy

New privacy-relevant work should identify affected data categories and processing boundaries. FidesLang implementation and validation are milestone work; do not claim coverage without evidence. Tenant isolation must be enforced independently of optional end-user privacy tooling.

## Licence and maintenance

Contributions are made under the repository's MIT licence. Preserve existing copyright and permission notices. Nathan (`@nathcymru`) currently maintains the project and makes scope and release decisions. Review timing depends on availability.
