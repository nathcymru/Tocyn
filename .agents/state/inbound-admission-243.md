# #243 inbound admission — partial implementation

Owner: coordinator `/root`; branch `codex/243-inbound-admission`, based on accepted
`e4ce508589d14a00337c20df2505172da87af727`. Work resumed 13 September 2026.

Implemented, not yet connected to the inbound handler:

- Tenant-qualified permanent deduplication identities, bounded to 4,096 per tenant;
  no automatic expiry that would replay old mail.
- At most three attempts, each requiring grant authority; exact expired-attempt takeover and stale-worker
  rejection. Current mailbox and budget policy fences share the native D1 batch
  with the grant link, attempt state and eventual relational effects.
- Per-attempt raw-content preparation binds the receipt digest before commit;
  recovery must verify its own bytes against the same digest. Native regressions
  reject commit-before-prepare and substituted recovery content.
- A bounded raw reader (2 MiB and 32,768 chunks), including cancellation and
  truncated/oversized source handling. These limits are preparation defaults to
  reconcile with the final resource envelope before handler integration.

The native D1 tests seed synthetic grant authority; they prove transaction fences,
not real BudgetCoordinator reservation, envelope sizing, MIME parsing, R2 recovery
or complete #243 acceptance. Existing inbound behavior is unchanged.

Remaining: trusted stable source identity, admission before raw reads, system
principal integration, canonical customer/ticket/article transaction, durable
attachment manifests and uncertain-R2 recovery, precise charging/settlement,
handler failure behavior, full native two-tenant and attachment-boundary evidence.
Do not close #243/#64 or issue Beta.2 from this partial primitive.

Routing: coordinator retains transaction/security decisions. Cloud gpt-oss:120b
proposed a raw reader; coordinator corrected missing cancellation/error handling,
removed retained chunk buffers and added a work bound. Local Granite inference
passed after cache purge earlier in this task; after reboot available RAM was
5.7 GiB, below the unchanged 6 GiB cold-start guard, so no further local load was
forced. One execution-capable agent owns independent #138 browser evidence.

Executed checks: native D1 receipt suite (8 tests), bounded raw reader Vitest
suite (11 tests), server TypeScript and the dedicated native-suite TypeScript
configuration all passed. Both full and production-only npm audits reported zero
vulnerabilities. PR #260 subsequently merged the independent utility fix at
`c09647796a73f7e0440f8006d66230c43532e1d3`; this branch fast-forwarded to that
accepted revision without changing the tested server files.

Graphify queried accepted main and returned the exact revision above. Bounded
source reads resolved insufficient semantic matches. No measured token savings
or separate native-agent allowance is claimed.

13 September routing update: maintainer requests three useful GPT subagents, local
Ollama for substantial low-impact proposals, free cloud for medium-impact proposals,
and scarce Spark only for bounded high-impact work. Three native agents own #132
preferences delivery, #138 integrated browser evidence and #137 legacy owner-writer
work. Coordinator owns #243/integration. Observed regular weekly allowance: 95%
remaining; separately reported Spark weekly allowance: 2% remaining. No separate
Work allowance is established. Local RAM: 5.54 GiB available, below unchanged 6 GiB
cold guard. Cloud attachment-case proposal was truncated and contradicted the
verified receipt lifecycle; rejected, not accepted evidence or completed tests.

Attachment-manifest increment: each prepared attempt must explicitly persist its
bounded manifest (including an empty manifest) before committing. Up to ten
artifacts and 2 MiB total are allowed. Attempt-qualified object IDs prevent a late
write from overwriting a recovery object's key. Provider acknowledgement must
match exact persisted metadata and current authority; unacknowledged historical
artifacts remain planned and auditable. These are native D1 primitives, not yet
R2 execution or cleanup/settlement integration. Native suite now 9 passing tests;
an initial synthetic source-ID collision between two tests was corrected.

Raw reader suite now 14 passing tests: exact byte ceiling, invalid chunk and
producer-buffer reuse added. Free cloud supplied a bounded proposal after a
verified source packet; coordinator corrected the proposed buffer timing, reduced
assertion cost and ran the tests. No worker test execution is claimed. Local RAM
was 4.8 GiB after browser/build work, so local inference remained guarded.

Maintainer's detailed routing guide is applied: Granite small repetitive batches
within4096context, free cloud larger contained proposals within8192context,
GPT owns consequential decisions and real execution/acceptance. Three native
agents progress #132/#137/#138. The30-minute task heartbeat reports acceptance
progress and an evidence-based testing ETA, explicitly distinguishing the preview
from accepted Beta.2. No reliable overall ETA established yet.

Further preparation: bounded source identity now hashes tenant, normalized envelope
sender/recipient and a required conservative Message-ID header; changed subject or
raw size is an envelope conflict. This is not authentication and unsupported IDs
are rejected rather than randomized. Nine identity tests pass. Cloudflare's email
handler API exposes headers and rawSize before stream consumption:
https://developers.cloudflare.com/email-service/api/route-emails/email-handler/

Internal inbound admission adapter requires combined admission, a trusted system
inbound-email scope and at most3attempts, binds exact operation/fingerprint and
recovery purpose, and preserves unknown settlement. Six mocked-adapter tests and
server TypeScript pass; actual DO accounting evidence and a reviewed complete
composition resource envelope remain required. The handler is still unwired.
A further cloud matrix contradicted the explicit rejection-result contract and was
rejected; coordinator wrote and executed the boundary tests. No proposal is
represented as independent acceptance.

The existing canonical transaction builder was extracted behavior-preservingly by
an execution-capable GPT agent against mainb84453fe, preserving the merged owner
activity/CAS fix. Coordinator reviewed the extraction; focused canonical replay,
rollback/SLA/precondition and latest assignment regressions passed in its worktree.
This enables later composition but adds no inbound actor/schema authority yet.

Integration against signed main `8d287c4c747fb1ee543e33abadf90ed184af2fe9`
combined exactly thirteen scoped files in an isolated worktree. The integrated
revision passed server and receipt-runtime typechecks, all29 focused raw/identity/
adapter tests (14/9/6), and all9 native D1 receipt tests. Existing latest-main
assignment activity/CAS and unrelated dashboard evidence are retained. No inbound
handler wiring, remote action or full admission/accounting acceptance is claimed.

## 13 September 2026 — canonical inbound and real reservation evidence

Current coherent increment adds constrained system/email provenance migration,
canonical inbound customer/ticket/article/SLA/audit composition, and durable R2
artifact fencing plus a bounded attachment writer. Every attachment's bytes and
metadata are copied before the first asynchronous boundary; the complete manifest
precedes object writes. Unknown provider acknowledgments propagate without deletion
or refund. The inbound handler remains unwired.

Executed local synthetic evidence: provenance migration 6 native test nodes,
canonical inbound 5, actual BudgetCoordinator admission 5, receipt/R2 11,
attachment helper 21 unit cases, and raw reader 14 unit cases. Server TypeScript
and focused native configurations pass. The real admission suite exercises the
actual adapter, cache, authority repository and DO: reservation links, replay with
no additional central liability, tenant isolation, exhausted/revoked denial, and
bounded recovery while unknown liability remains charged. Its explicit policy and
resource envelope are fixtures; recovery advances the durable attempt lease only.
Canonical and receipt suites use synthetic grant fixtures and do not independently
prove actual DO accounting. Migration rollback, projection/redaction preservation
and foreign-key checks pass locally; target-size migration rehearsal is outstanding.

Remaining acceptance: reviewed complete composition envelope and MIME bounds,
admission-before-read handler integration, end-to-end replay/charge/attachment
behavior, and runtime/release clearance. No provider activation, remote data change,
release, or completion of #243/#64/Beta.2 is claimed. Migration is a full table
rebuild; backup/rehearsal is required before deployment and new gateway rows prevent
a blind downgrade.

Execution-capable GPT agents ran these tests and coordinator reviewed production
changes. No Copilot review requested; checked-in setup remains manual-only and the
live named Copilot ruleset contains only deletion/non-fast-forward protections.
Project #243 is confirmed In progress with Actual start 2026-09-13. Progress and
forecast fields are blank; no weighted percentage or reliable completion date is
invented. Baselines are preserved. This partial is packaged on the existing draft
PR #261; original-root duplicate edits are preserved untouched.
