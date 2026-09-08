# Contributor setup verification — 8 September 2026

Issue: [#20](https://github.com/nathcymru/Tocyn/issues/20). Source baseline:
`2eedcab2458685612d7c4e92c9d69234cc99e844`, plus the accompanying setup PR.
This records local contributor checks, not private-beta or deployment acceptance.

The walkthrough used a clean isolated checkout on macOS with Node 22.19.0 and npm
10.9.3. The checked-in local profile names a distinct local D1 database and R2 bucket,
plus the existing NotificationDO class. It does not configure remote AI, Vectorize,
Workflow, mail credentials or production resource identifiers.

| Check | Observed result |
| --- | --- |
| `npm ci --ignore-scripts` | Locked dependency installation passed; native SQLite tests need the normal install below. |
| `npm ci` | Passed with the native SQLite binary available. This is the documented contributor/CI install. |
| Copy synthetic `.dev.vars.example`; `npm run db:migrate:local` | All 23 migrations applied to the distinct local database. |
| `npm run dev:server` | Local-only bindings listed at startup; `/health` returned HTTP 200. |
| Dashboard and portal development servers | Started; independent HTTP probes returned 200 HTML. |
| Widget development server | Started; `/src/main.tsx` returned HTTP 200 JavaScript. It is a library, with no standalone HTML page or API proxy. |
| Portal lint and server `npx eslint .` | Passed. |
| Server typecheck | Passed. |
| Dashboard, portal and widget builds | All passed. |
| `npm test` | Passed: 322 server tests, 12 portal tests, 3 widget tests, plus reset-admin and context-tool checks. |
| Local D1 smoke test | Passed, including rejected cross-tenant foreign-key write and database integrity checks. |
| Miniflare D1 integration test | Passed with two synthetic tenants, real migration chain and existing auth/API-key/retention isolation checks. |
| Full and production-only npm audits | Both reported zero findings for this lockfile at verification time. |
| Diff whitespace check | Passed. |

The independent browser-server probes used distinct localhost ports with strict port
selection and stopped all spawned processes afterward. They verify HTTP serving;
they do not establish authenticated browser workflow or accessibility acceptance.

## Resource use, failure and recovery

Observed local disk allocation after the walkthrough: root dependencies 544 MiB,
server `.wrangler` state 2.4 MiB; dashboard, portal and widget build directories
approximately 1.5 MiB, 280 KiB and 472 KiB respectively. These are workstation disk
measurements, not provider billing or deployed workload-capacity estimates.

The initial test run after installation with scripts disabled failed because the
native SQLite binary was absent. The normal documented `npm ci` resolved that failure;
all required local checks then passed. No forced dependency upgrade was used.

Stop the development Worker before removing its ignored `.wrangler` directory and
reapplying local migrations to recreate synthetic state. Never apply this local-reset
procedure to a remote resource. Existing integration checks exercise tenant-denial and
retention failure/retry behavior; remote rollback/restore remains #57/#42 evidence.

## Acceptance limits

The synthetic provisioning evidence here is the reproducible isolated D1 fixture
harness. It does not create reusable interactive test-user credentials. #58 owns
repeatable two-tenant onboarding for the isolated environment, and must not be closed
on this evidence. Portal/operator end-to-end acceptance remains #61/#62.

No remote resource was created, migrated or seeded; no application was deployed, no
authentication mail sent, and no paid AI invoked. AI/knowledge features are omitted
from this local profile. The inherited deployment commands remain historical and
unapproved as a contributor runbook. #57 owns a reviewed isolated environment and
#65 owns the final beta rehearsal. All twelve beta blockers were open at the start
of this verification; successful local setup alone does not make the beta ready.
