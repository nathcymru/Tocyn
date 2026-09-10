# Deployment residency and jurisdiction

This is an implementation contract for issue #160. It describes capability evidence and synthetic validation; it does not provision resources, migrate data, certify legal compliance or promise that storage location equals processing location.

## Deployment policy

Residency is a deployment capability. An ordinary tenant profile, URL, request body, webhook, path field or query parameter cannot select a jurisdiction or grant authority. Tenants may use only the capabilities declared by their deployment. Tenants with incompatible hard-residency requirements use separate deployments/resources in v1.

The machine-readable contract is implemented by `scripts/deployment/residency-manifest.mjs`. It validates a manifest with `schemaVersion: 1`, a deployment `policy`, a `capabilities` matrix and `resources` evidence. `evidenceCheckedAt` and HTTPS primary-source URLs are required for every component. Unknown evidence never becomes a guarantee.

## Capability matrix

Each component has independent `storage` and `processing` statuses: `guaranteed`, `best-effort`, `unrestricted`, `unsupported` or `unknown`. The matrix covers:

| Component | Storage | Processing / execution | Current claim boundary |
|---|---|---|---|
| D1 | Database jurisdiction | Worker request path and database operations | Must be evidenced separately; creation policy can be immutable. |
| R2 | Bucket jurisdiction | Worker access and object operations | Jurisdictional bucket restrictions are creation-time; bindings must carry jurisdiction. |
| Durable Objects | Object persistence/jurisdiction | Worker-to-DO invocation | DO jurisdiction does not constrain the Worker that calls it. |
| Vectorize | Derived vector storage | Vector queries/writes | Treat as global/unknown unless current documentation proves a narrower guarantee. |
| Workers AI | No Tocyn storage guarantee | Inference/embedding processing | Data-use controls do not by themselves prove processing locality. |
| Queues | Message storage | Consumer execution | Must be evidenced independently; no inference from Worker HTTP locality. |
| Cron | Trigger metadata | Scheduled execution | Regional HTTP controls do not establish Cron locality. |
| Workflows | Workflow state | Step execution | Must be evidenced independently for each material path. |
| Worker HTTP | Request processing | Regional Services / routing | A configured route is not proof for asynchronous triggers. |
| Logs/traces | Observability metadata | Collection/retention processing | Account/provider settings require separate evidence. |
| External providers | Provider-side storage | Provider-side processing | Tenant/provider contract and region evidence are required. |

For a hard profile, every enabled component must have `guaranteed` storage and processing evidence. A component that is unsupported must be disabled or the deployment must state a narrower claim. The validator fails closed instead of silently downgrading.

## Immutable resources and migration

The manifest records `jurisdiction`, `immutableAtCreation` and `migrationPlan` for D1, R2 and Durable Objects when a hard profile is claimed. Changing a creation-time jurisdiction requires an explicitly reviewed new resource and migration/cutover plan; a binding or metadata edit cannot be treated as an in-place conversion. Existing data remains governed by its original resource until migration evidence is complete.

The validator is source-only and synthetic. It performs no Cloudflare API calls, resource creation, migration, deployment, provider activation or customer traffic operation.

## Current evidence checked

Evidence was checked on 10 September 2026 against primary Cloudflare documentation:

- [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/) — jurisdiction restrictions, jurisdiction-bearing bindings, and bucket jurisdiction immutability.
- [Durable Objects data location](https://developers.cloudflare.com/durable-objects/reference/data-location/) — jurisdiction constrains the object’s run/persist location, not the calling Worker; object IDs may be logged outside the jurisdiction.
- [Workers placement](https://developers.cloudflare.com/workers/configuration/placement/) — request placement controls do not establish locality for every asynchronous path.
- [Cloudflare D1 documentation](https://developers.cloudflare.com/d1/) — recheck exact database-region controls during provisioning because API and plan coverage can change.
- [Cloudflare Queues documentation](https://developers.cloudflare.com/queues/) and [Workflows documentation](https://developers.cloudflare.com/workflows/) — recheck execution/storage locality before making a hard claim.
- [Cloudflare Vectorize documentation](https://developers.cloudflare.com/vectorize/) and [Workers AI documentation](https://developers.cloudflare.com/workers-ai/) — no hard per-deployment processing-locality claim is inferred without explicit current evidence.

Documentation is evidence, not a legal conclusion. The validator and this page intentionally retain `unknown`/`unsupported` states until a current provisioning check supplies stronger evidence.

## Validation

Run the synthetic test directly:

```sh
node --test scripts/deployment/residency-manifest.test.mjs
```

The tests cover unrestricted and fully constrained fixtures, unknown/unsupported services, missing evidence, immutable-resource mismatch, missing migration consequences, request-jurisdiction rejection and incompatible hard-residency separation.
