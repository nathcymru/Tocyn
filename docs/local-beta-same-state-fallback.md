# Local same-state code fallback

This future #65 check is separate from parked-artifact reproducibility. A `park`
artifact disables application routes, so it cannot establish that a local
application can read accepted state after a code switch.

The fallback has one runner-owned persistent local state directory and two clean
source paths: a final candidate and an accepted signed known-good revision. It
may begin only when their checked-in server migration manifests match exactly.
It also verifies that the local D1 state contains the ticket, article, audit,
replay, and local-beta admission tables required by the workflow. Any mismatch
records the fallback as unavailable; it must not reset state, apply a reverse
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
