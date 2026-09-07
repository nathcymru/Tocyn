# PR 43 continuation review

PR #43 remains an application implementation change, not production clearance.
The original security register remains under #13; #19 retains its full acceptance criteria,
and #42 owns migration/cutover planning. The v0.1.0 milestone remains open.

## Corrections in this continuation

- Repaired core ownership migration ordering and preserved historical configuration and
  authentication challenges. Migration tests cover populated data, canonical collisions,
  ambiguous ownership rollback, and foreign-key integrity.
- Customer challenge redemption uses a conditional database write with `RETURNING`.
  Both SQLite and local D1 tests check concurrent redemption and tenant ownership.
- Portal routing keys survive navigation and emailed verification links. Embed scripts
  supply `data-widget-key`; fixed portal installations may set `VITE_WIDGET_KEY`.
  Configure trusted `PORTAL_URL` in scoped configuration or the Worker environment.
- Configuration services receive scoped dependencies and narrow identity resolvers.
  Tenant email credentials require the configured master key and successful decryption.
- Restored dashboard lists, filters, aggregates and outbound reply dispatch through
  scoped repositories/services. Realtime objects and broadcasts use tenant-specific names.
- Scheduled retention and Vectorize workflow entrypoints use trusted system composition.
  Old workflow payloads without tenant ownership fail closed; planning must account for them.
- Article-body reads are bounded and prefer scoped R2 objects. Only the explicitly supplied
  default-tenant compatibility adapter may read historical unscoped keys.
- Excessive markup depth produces a controlled knowledge-route rejection.

## Verification and remaining boundaries

The established server pipeline, portal tests/builds and agent-context tests are required
on the final revision. Test results and exact commit SHA belong in the PR receipt.
Successful checks do not count as an approving review.

Rehearse migrations **0014–0019** together against backups before any separately authorized
rollout. Existing deployment credentials may need explicit encryption/configuration planning;
do not reinterpret missing credentials as permission to use another tenant's configuration.
Legacy global service implementations retained for historical tests are not production entrypoints.
Their remaining lint exemptions are not evidence of complete repository-wide boundary enforcement.

Remaining private security-register findings and operational prerequisites continue under #13,
#19 and #42 as applicable. Detailed unpatched findings remain private. R16/R17 are security-register identifiers under #13, not issue #16/#17.
Repository-wide Actions SHA enforcement remains deferred. No production execution is included.
