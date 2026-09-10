# Deployment residency and jurisdiction

This is an implementation contract for issue #160. It describes capability evidence and synthetic validation; it does not provision resources, migrate data, certify legal compliance or promise that storage location equals processing location.

## Deployment policy

Residency is a deployment capability. An ordinary tenant profile, URL, request body, webhook, path field or query parameter cannot select a jurisdiction or grant authority. Tenants may use only the capabilities declared by their deployment. Tenants with incompatible hard-residency requirements use separate deployments/resources in v1.

The machine-readable contract is implemented by `scripts/deployment/residency-manifest.mjs` and is invoked while preview/beta release manifests are read. It validates a nested `residency` object with `schemaVersion: 1`, an explicit deployment `policy`, a `capabilities` matrix and resource evidence. Every component has explicit `enabled`, `storage` and `processing` objects; each dimension records status, jurisdiction, `evidenceCheckedAt`, sources and `verification` (`pending` or `verified`). Evidence URLs and dates are provenance, never proof of a live deployment. Unknown or pending evidence never becomes a guarantee.

## Capability matrix

Each component has independent `storage` and `processing` statuses: `guaranteed`, `best-effort`, `unrestricted`, `unsupported` or `unknown`, plus independent jurisdiction and verification metadata. Profiles are exactly `unrestricted`, `best-effort` and `hard`; a hard profile carries a non-empty jurisdiction.

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

For a hard profile, every enabled component must have `guaranteed` storage and processing evidence with `verification: verified` and a jurisdiction matching policy. A component that is unsupported must be disabled or the deployment must state a narrower claim. Enabled flags must agree with the release manifest's disabled-capability list, and resources cannot independently disable an enabled capability. The validator rejects unknown fields, malformed profiles, empty jurisdictions, cycles, excessive nesting/size and silent downgrades.

## Immutable resources and migration

The manifest records `selectedJurisdiction`, `verifiedJurisdiction`, `verification`, `immutableAtCreation` and `migrationPlan` for D1, R2 and Durable Objects. Pending resources have a null verified jurisdiction; verified resources must match their selected jurisdiction. Hard profiles additionally require verified resource metadata, the policy jurisdiction and creation-time immutability. Changing a creation-time jurisdiction requires an explicitly reviewed new resource and migration/cutover plan; a binding or metadata edit cannot be treated as an in-place conversion. Existing data remains governed by its original resource until migration evidence is complete.

The validator is source-only and synthetic. It performs no Cloudflare API calls, resource creation, migration, deployment, provider activation or customer traffic operation.

## Current evidence checked

Evidence was checked on 10 September 2026 against primary Cloudflare documentation:

- [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/) — jurisdiction restrictions, jurisdiction-bearing bindings, and bucket jurisdiction immutability.
- [Durable Objects data location](https://developers.cloudflare.com/durable-objects/reference/data-location/) — jurisdiction constrains the object’s run/persist location, not the calling Worker; object IDs may be logged outside the jurisdiction.
- [Workers placement](https://developers.cloudflare.com/workers/configuration/placement/) — request placement controls do not establish locality for every asynchronous path.
- [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/) — jurisdictions are creation-time and constrain database execution/storage, not the calling Worker. Location hints alone are not guarantees; changing jurisdiction requires a new database and migration.
- [Cloudflare Queues documentation](https://developers.cloudflare.com/queues/) and [Workflows documentation](https://developers.cloudflare.com/workflows/) — recheck execution/storage locality before making a hard claim.
- [Cloudflare Vectorize documentation](https://developers.cloudflare.com/vectorize/) and [Workers AI documentation](https://developers.cloudflare.com/workers-ai/) — no hard per-deployment processing-locality claim is inferred without explicit current evidence.

Documentation is evidence, not a legal conclusion. The validator and this page intentionally retain `unknown`/`unsupported` states until a current provisioning check supplies stronger evidence.

## Validation

Run the synthetic test directly:

```sh
node --test scripts/deployment/residency-manifest.test.mjs
```

The tests cover unrestricted and fully constrained fixtures, unknown/unsupported services, missing evidence, immutable-resource mismatch, missing migration consequences, request-jurisdiction rejection and incompatible hard-residency separation.

The current isolated release generator emits unrestricted resource bindings. It therefore rejects hard-profile release preparation, even when synthetic metadata passes the standalone validator. Jurisdiction-aware provisioning and live binding verification remain explicit #57/#42 requirements. No manifest assertion can silently turn the current generator into a constrained deployment. Outbound external-provider paths remain enabled/unknown in the capability matrix: disabling inbound Email Routing does not prove outbound providers disabled. Current source manifests carry pending evidence and make no live locality claim.
