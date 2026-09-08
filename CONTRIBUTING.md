# Contributing to Tocyn

Tocyn is an early-stage MIT-licensed fork of Luminatick, developing a multi-tenant helpdesk on Cloudflare. Documentation, testing, accessibility and security contributions are as valuable as feature code.

## Find work and coordinate

Read the [roadmap](docs/roadmap.md). Use Discussions for questions and proposals, and issues for agreed work and reproducible bugs. Comment on an issue before a substantial change to avoid overlapping another contributor or agent. Small corrections can be proposed directly.

Describe the intended behaviour and acceptance criteria before large architectural changes. Follow the [code of conduct](CODE_OF_CONDUCT.md); report security concerns through [SECURITY.md](SECURITY.md).

## Development setup

Use Node.js `>=22.12.0 <23` and npm 10. The repository is an npm workspace with a root lockfile. The same Node range is used by CI.

```bash
git clone https://github.com/nathcymru/Tocyn.git
cd Tocyn
npm ci
cp apps/server/.dev.vars.example apps/server/.dev.vars
npm run db:migrate:local
npm run dev:server
```

This starts the API at `http://localhost:8787` with local D1, R2 and Durable Object emulation. Workers AI, Vectorize and the vectorisation Workflow are deliberately omitted from this configuration, so AI/knowledge routes are not part of the wholly local walkthrough. The example variables are synthetic development values. Do not put account tokens, provider keys, or production values in `.dev.vars`.

In separate terminals, start the interfaces you need. Dashboard and portal proxy `/api` to the local API. The widget is a script library without a standalone HTML page or development API proxy: its dev server serves `/src/main.tsx`. An embedding application supplies its API origin through `VITE_API_URL` and its public configuration selector through `data-widget-key` or `VITE_WIDGET_KEY`; an authenticated customer token is still required. Use synthetic values only.

```bash
npm run dev:dashboard
npm run dev:portal
npm run dev --workspace=apps/widget
```

The obsolete `db:seed:local` and server `seed` commands have been removed. Their historical generator requires `--legacy-schema` and may only target a separately reviewed pre-tenant local database. Do not use it for setup or tenancy evidence. Repeatable two-tenant fixture/provisioning is tracked by [#58](https://github.com/nathcymru/Tocyn/issues/58). Until that fixture exists, use the isolated D1 checks below as the synthetic tenancy demonstration.

The checked-in production-oriented `apps/server/wrangler.json` retains inherited remote D1, R2, Vectorize and Workers AI identifiers. It is not used by the default server command. `apps/server/wrangler.local.json` contains only distinct local D1, R2 and Durable Object bindings, so the documented development route needs no Cloudflare login, account, remote resource, provider key, or paid AI call.

Local Worker state is stored under `apps/server/.wrangler/` and is ignored by Git. To reset local D1/R2/DO state, stop the server and remove that directory; then rerun the migration command. This deletes only local synthetic state. The inherited [deployment guide](docs/deployment.md) is not a validated provisioning route. Commands containing `:prod`, `--remote`, or `deploy` affect Cloudflare resources and are outside normal contributor setup.

To create a migration for a scoped schema change, run `npm run migration:create --workspace=apps/server -- descriptive_name`. This selects the same local configuration and writes a new SQL file under `apps/server/migrations`; it does not apply that migration to a database. Review the SQL before applying it locally.

| Profile | Resources and consumption | Recovery |
| --- | --- | --- |
| `wrangler.local.json` | Local D1 rows, R2 objects and Durable Object state stored under `.wrangler`; no Cloudflare account or billable resource is used. AI, Vectorize and Workflow features are omitted. | Stop the Worker, remove `apps/server/.wrangler/`, and rerun `npm run db:migrate:local`. |
| `wrangler.json` | Inherited deployment bindings name D1, R2, a Durable Object, Vectorize, Workers AI and a Workflow. D1/R2 operations and storage, Durable Object activity, Vectorize queries/storage, AI inference and Workflow executions can consume provider resources when deployed or deliberately connected remotely. | Environment inventory, backups, rollback and remote recovery are controlled by [#57](https://github.com/nathcymru/Tocyn/issues/57); do not use local recovery commands on a remote account. |

## Checks

```bash
npm run lint --workspace=apps/portal
(cd apps/server && npx eslint .)
npm run typecheck --workspace=apps/server
npm run build --workspace=apps/dashboard
npm run build --workspace=apps/portal
npm run build --workspace=apps/widget
npm test
(cd apps/server && bash ./scripts/d1-smoke-test.sh)
(cd apps/server && npx tsx scripts/d1-integration-test.ts)
```

The D1 smoke test creates a temporary local database, proves a cross-tenant foreign-key write is rejected, and runs foreign-key and quick checks. The Miniflare integration check runs the migration chain with two synthetic tenants and exercises application isolation paths. These checks do not prove a deployed Cloudflare environment or authenticated browser onboarding; #58 owns repeatable local tenant fixtures and #57 owns isolated environment verification. Report pre-existing failures instead of suppressing them.

See the [8 September setup verification](docs/maintenance/contributor-setup-verification.md) for observed results and limitations.

## Pull requests

Fork the repository or use a dedicated branch. Open the PR against Tocyn's `main`. Explain the problem, change and evidence of validation. Include screenshots for visible changes and tests for meaningful behavioural changes.

Keep formatting-only changes separate from functional work. Follow nearby conventions until the coding-standard issue selects and configures the formatter and lint rules. Prettier is under consideration, not yet a mandatory dependency.

The default branch requires verified commits; feature branches may contain unsigned commits. All changes go through a PR with passing checks and a verified final commit. GitHub may restrict squash merges of another author's PR into a signed branch; coordinate the verified merge path with the maintainer. Repository administrators have a PR-only review exception for solo-maintainer work; this does not bypass CI, signatures or main integrity.

Do not commit credentials, personal data or production exports. AI-assisted contributions are welcome when the contributor understands the change, verifies it, preserves attribution and remains responsible for its correctness. Use synthetic examples with development AI tools.

## Privacy and tenancy

New privacy-relevant work should identify affected data categories and processing boundaries. FidesLang implementation and validation are milestone work; do not claim coverage without evidence. Tenant isolation must be enforced independently of optional end-user privacy tooling.

## Licence and maintenance

Contributions are made under the repository's MIT licence. Preserve existing copyright and permission notices. Nathan (`@nathcymru`) currently maintains the project and makes scope and release decisions. Review timing depends on availability.
