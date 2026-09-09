# Local same-state code fallback

This implemented #65 helper is separate from parked-artifact reproducibility. A `park`
artifact disables application routes, so it cannot establish that a local
application can read accepted state after a code switch.

The fallback has one runner-owned persistent local state directory and two clean
source paths: a final candidate and an accepted signed known-good revision. It
may begin only when their checked-in server migration manifests match exactly.
It also verifies that the local D1 state contains the ticket, article, audit,
replay, and local-beta admission tables required by the workflow. A migration
manifest mismatch records the fallback as unavailable. A positively identified
missing required table in fixture-verified state records `runtime_schema_incompatible`
and makes the outer rehearsal fail; the inventory is checked before starting
either Worker and before authorized snapshot reads. Unreadable state, an invalid
fixture identity, HTTP/auth failures and preservation mismatches remain failures,
not inferred schema unavailability. In either case, it must not reset state, apply a reverse
migration, or present an empty application as recovery.

The candidate creates state only through the normal local runtime: fixture
bootstrap, supported local beta operator initialization, local capture magic
link verification, MFA staff sign-in, customer intake/follow-up, staff reply,
and a material state transition. It records a stable digest of authorized
customer detail and staff history plus bounded article/audit/admission counters.
No JWT, OTP/MFA secret, password, magic link, recipient, message body, ticket
identifier, capture body, or raw D1 query result enters the receipt.

After the candidate process stops, the known-good actual local runtime starts
against the exact same state and private run-owned secrets. It must recover the
existing authenticated customer and staff sessions through normal requests and
match the candidate canonical digest and durable counters. The runner then
removes its local state. This proves only compatible local code fallback; it is
not provider rollback, backup/restore, reverse migration, deployment, or
production evidence.

The orchestration helper accepts explicit clean candidate and known-good
worktree paths and their immutable revisions. It uses the rehearsal lifecycle's
managed-service API for each local Worker, so stopping the candidate preserves
the shared local state while verifying its owned process scope before the
known-good Worker starts. It does not read the lifecycle process registry or
create another process ownership mechanism.

The helper is invoked by the rehearsal runner in a separate owned Node/tsx
process. Its TypeScript loader and nested Worker processes remain covered by
the outer ownership scope. Source/fixture tests are not a final candidate
rehearsal receipt; actual scoped runtime and full rehearsal evidence are
recorded separately.

## Bounded runtime evidence

A Node 22/macOS run passed against clean candidate
`2314188a990265c98d67757048184d1815e3a3ec` and signed known-good
`58feb5e4deef55670f635f099eb67c6bcfffae56`. Including the clean known-good
checkout, locked offline install and native rebuild, it took 21.1 seconds.
Normal captured customer authentication and staff password/MFA authentication
created one ticket, four articles and four audit events. Restarting the
known-good code against that same state preserved the authorized canonical
digest and admission state: running, revision 1, one ticket, four mutations,
zero upload attempts. The inner and outer task cleanup both completed, and a
native bind probe confirmed port 8787 was released.

This receipt identifies the tested source commit. Later documentation or
integration commits are not silently substituted for that candidate. The
corrected accessibility/MFA source is integrated at signed
`65ad06ee3e905acf9ec59d17bdd951993381e818`. The final artifact build and acceptance-matrix rehearsal have not completed
successfully. The first accepted-source
attempt stopped before fallback at a runner command error, recorded in the
[rehearsal evidence](./local-beta-rehearsal.md). After the narrow correction is
accepted, the coordinator selects that exact signed revision as candidate and signed
`58feb5e4deef55670f635f099eb67c6bcfffae56` as the prior known-good application.
That technical run may proceed while owner-dependent screen-reader evidence is pending, but cannot
close #65 or claim readiness. Any later reader-driven source fix changes the
candidate and requires affected checks again. This bounded runtime check does
not claim production readiness.
