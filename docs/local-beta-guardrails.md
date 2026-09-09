# Local private-beta guardrails

This is the local-only implementation for issue #93, integrated with the accepted
conversation audit and retry commit path. Focused tests demonstrate durable local
admission, concurrent capacity, bounded reads and running-Wrangler operator
control. Required CI and browser acceptance determine delivery acceptance. These
controls do not authorize a remote beta or production operation and do not provide
delegated budgets or billing guarantees.

## Explicit local profile

Use Node 22 and install with `npm ci --ignore-scripts`; rebuild the local
`better-sqlite3` development dependency when required by the host runtime.

From an interactive terminal, run:

```sh
npm run fixture:local-beta --workspace=apps/server
```

This creates disposable, isolated local D1/R2/DO state, generates synthetic
credentials, initializes exactly `fixture-tenant-a` and `fixture-tenant-b`, and
sets `LOCAL_BETA_ENABLED=true` before starting Wrangler on `127.0.0.1:8787`.
The four real principals retain distinct canonical email identities and the
existing application/MFA/widget token audiences. Invitations use tenant, kind
and exact principal ID. Two scoped API keys are separately and explicitly
invited; creating a later key never admits it automatically. Interactive output
contains synthetic credentials and must not be saved in a receipt or shared log.

Start the existing frontends in separate local terminals:

```sh
npm run dev --workspace=apps/dashboard
npm run dev --workspace=apps/portal
```

The dashboard uses `http://localhost:5173`; the portal uses
`http://localhost:5174`. Leave `VITE_API_URL` unset to use their existing local API
proxies. Open a generated portal login URL to select its tenant widget key, then
use the captured local authentication journey. The dashboard uses the generated
operator password and existing MFA enrollment. Do not put credentials in frontend
configuration, screenshots, checked-in files or acceptance receipts. The launcher
requires interactive standard streams and refuses credential output in CI.

The ordinary `fixture:local-tenants` command remains the unguarded development
fixture for compatibility tests. It is **not** a beta rehearsal. A guarded
profile without valid durable policy returns `beta_admission_unavailable`;
there is no missing-policy fallback. The local entrypoint injects the captured
mail transport. Missing capture, provider credentials or an invalid guarded
profile fail closed. No remote account/config discovery is performed.

Only these three authentication destinations are captured:
`tocyn-auth-test@example.invalid`, `tocyn-auth-test-a@example.invalid` and
`tocyn-auth-test-b@example.invalid`. Operator password identities are not new mail
destinations. Unknown or non-invited pre-authentication customer requests retain
a generic response and create no account, token or captured message.

## Operator control and durable capacity

The launch prints its local state directory. Inspect it before a change:

```sh
npm run beta:operator --workspace=apps/server -- status --local --persist-to /absolute/local/state
npm run beta:operator --workspace=apps/server -- stop-intake --local --persist-to /absolute/local/state --expected-revision 1
npm run beta:operator --workspace=apps/server -- stop-writes --local --persist-to /absolute/local/state --expected-revision 2
npm run beta:operator --workspace=apps/server -- resume --local --persist-to /absolute/local/state --expected-revision 3
```

The operator uses only the existing local D1 simulation file and validates the
four-principal fixture. No HTTP tenant administrator endpoint can change policy.
Every change compares the expected revision and preserves a receipt. Stop-intake
rejects new tickets and upload attempts, while allowing bounded recovery replies
and material state/assignment changes. Stop-writes rejects all new conversation
mutations and uploads. Authorized reads and valid immutable saved responses remain
available. Resume and Worker restart retain counters; resume does not restore
capacity already used. Teardown deletes the disposable state, as explicitly
requested by the fixture command; it is not a run reset or production cleanup.

The conservative defaults are implementation choices for this rehearsal:

| Counter | Default | Meaning |
| --- | ---: | --- |
| New tickets | 100 | Successful ticket commits |
| Conversation mutations | 1,000 | Successful create, reply/note or material ticket change |
| Recovery reserve | 200 | Creation stops at 800 mutations, retaining capacity for accepted tickets |
| Upload attempts | 100 | Durable charge before R2, including failed or uncertain attempts |

A create with its initial article is one mutation. Replays, no-op transitions,
invalid input, denied authorization and rolled-back transactions consume no
committed mutation slots. A new request after an expired retry receipt can create
a new mutation and therefore consumes capacity. Upload attempts are separate from
successful commits and are never automatically refunded.

Initialization accepts lower positive limits and explicit invitations. A new run
requires an operator `new-run` command with a bounded JSON policy file and the
current revision. Prior run counters remain in `local_beta_runs`; the new-run
receipt preserves their aggregate values. The CLI does not accept limits above
the conservative defaults. Configuration/parse/I/O failures report a fixed error
without echoing input. New tenants, recipients, external providers or higher
capacity require separate owner scope.

## Enabled route inventory

`localBetaRoute` is an exact positive inventory. Any new, unclassified route is
disabled in the guarded profile. Existing credential, role, MFA, permission,
tenant and ownership checks remain mandatory after this inventory gate.

| Route family | Guarded behavior |
| --- | --- |
| `GET /health` | Requires valid guarded runtime and policy |
| `/api/auth/login`, logout, me, MFA setup/confirm/verify/disable | Existing password/MFA/session flows plus explicit invitation |
| `/api/v1/customer/auth/request`, verify, logout, me | Exact invited customer identity and captured destinations; widget audience remains required |
| `GET /api/v1/customer/config` | Tenant is resolved from the widget key |
| `/api/v1/tickets`, `/:id`, `/:id/articles`, `/:id/history` | Existing API-key conversation methods only; exact key invitation and permissions |
| `/api/v1/customer/tickets`, `/:id`, `/:id/messages`, `/:id/history` | Customer-owned public conversations only |
| `/api/tickets`, `/:id`, `/:id/articles`, `/:id/history` | Authenticated human handling, internal notes, assignment/state and reads |
| `/api/attachments` and `/api/v1/customer/attachments` upload/download | Existing file/prefix/ownership checks; separate upload-attempt gate |
| Dashboard stats, ticket fields, agent list, groups, settings/filter reads, permissions, realtime | Human handling dependencies; existing authorization applies |
| Widget config/session/chat/ticket routes | Disabled; beta intake uses API/portal routes |
| Knowledge/AI/QA/indexing, all channel routes, automations, API-key management | Disabled before optional work is dispatched |
| Settings changes/usage provider query, field/group/membership/filter/permission changes, user administration | Disabled |
| Email, scheduled work and vector workflows | Not exposed by the local entrypoint; no optional bindings in the launch config |
| Any unclassified route | `503 feature_disabled` |

Wildcard widget CORS does not advertise API-key or retry headers. Those headers
remain available only on configured exact non-widget origins.

## Request and read bounds

Guarded JSON operations accept one object, with streamed 64 KiB body limits;
array batches are rejected. Existing create/reply limits retain 300-character
subjects, 16,000-character messages and ten attachment references. Uploads retain
a 10 MiB file ceiling and a bounded multipart envelope. File type, filename and
trusted tenant/user storage prefix validation still applies.

Ticket list pages are 1–1,000 with page sizes 1–50 (default 50); malformed,
negative, fractional and prefixed numeric values return 400. Article detail uses
ascending `(created_at,id)` cursors, at most 50 articles per page, and explicit
`pagination.has_more`/`next_cursor`. Public visibility and current ticket ownership
are filtered in SQL before limiting. The canonical messages describe only the
returned article page. Its conversation-level intake audit reference remains
truthful independently of that page, provided the initial message is currently
public; a newly hidden initial message does not expose that reference. Stored response-version-1 retry receipts keep their frozen
original renderer.

Article body metadata is measured before loading bodies. A page uses a 256 KiB raw
article budget and a separate 256 KiB attachment metadata budget, at most 500
attachment rows, and a final 1 MiB JSON read response ceiling. A page may contain fewer
than its requested number of articles when its byte budget is reached. The next
cursor makes this visible. An oversized individual legacy article or R2-backed
legacy body gives a controlled error for operator review; no body is silently
omitted or automatically imported. Four scoped queries suffice for both one and
50 selected articles, including one batched attachment query. This is the article
page repository query count; authentication, ticket lookup and one bounded audit
reference query are additional request work. The audit reference result contains
at most 51 rows. Mutation payloads and retry snapshots are bounded before commit;
the generic read response ceiling never converts a committed mutation into a
post-commit 413. Oversized inherited API PATCH response data is rejected before
changing the ticket or charging a mutation.

Portal and dashboard show a native Load more messages button and a polite status
region. Existing messages remain during loading and errors, and the completed
control remains present for focus continuity. Styling uses static CSS utilities;
no browser component is imported into the API Worker.

## Diagnostics and evidence boundaries

Each local runtime retains at most 1,000 fixed metadata records, each under 1 KiB,
with a 24-hour TTL evaluated on access. Records contain only route class, outcome,
revision and timestamp; never bodies, tokens, recipients, paths or raw database
errors. Diagnostics clear when a stopped policy is observed and on runtime
restart/teardown. This is access-time pruning, not unattended physical deletion
of data in a dormant process. Capture retains its existing independent short TTL.
Only aggregate synthetic counts belong in saved acceptance receipts.

The focused checks are repeatable from the repository root:

```sh
npm run typecheck:local-beta --workspace=apps/server
npm run test:local-beta --workspace=apps/server
npm run test:local-beta-runtime --workspace=apps/server
```

The runtime command runs the Worker proof and then the interactive launch/cleanup
proof sequentially. Both own `127.0.0.1:8787` while running. Stop any interactive
fixture first; the tests refuse an occupied port and never select a remote
fallback. The launch proof uses Python 3 standard-library pseudo-terminal support
on macOS/Linux so the supported npm command receives a real controlling terminal,
even when the test runner has piped streams. No credential output is written to
logs or receipts.
The normal server test suite includes policy and defensive retry-renderer tests.
Portal and dashboard test suites include pagination loading, status and focus
regressions. Run the existing retry and audit suites against the same revision
for compatibility evidence; required repository CI remains mandatory.

| Local evidence | Measured or asserted result |
| --- | --- |
| Two-tenant final-slot race | Two contenders, one new commit, no exceeded ceiling |
| Same-key final-slot recovery | Matching successful responses, one charge; saved response works while stopped |
| Atomic fault injection | Admission, ticket, article, attachment, audit and receipt failures preserve all prior committed row/counter counts |
| Material change and no-op | One charge for a material transition; zero for a repeated or stopped no-op |
| Expired and removed retry results | One new charge after expiry; removed result returns 410 without restoring capacity |
| Upload boundary | Durable attempt before R2; failed/uncertain attempts remain charged; stopped/exhausted upload makes zero R2 calls; accepted object remains downloadable |
| Bounded article page | Four page queries at sizes 1 and 50; zero legacy R2 reads and zero foreign/internal article leakage |
| Operator and running Worker | Warm connections observe revision changes; concurrent stop counters equal successful commits; restart retains stop/counts; resume does not reset capacity |
| Disabled optional work | No provider, AI, vector or workflow binding in the local runtime configuration |
| Diagnostics | At most 1,000 fixed records, each under 1 KiB; access-time TTL and stop/restart reset; malformed policy fragments never appear in CLI errors |

These are synthetic local resource and correctness assertions, not latency,
production load, provider spending or storage deletion guarantees. In particular,
R2 uncertainty can leave an unreferenced local object until fixture teardown; the
counter is conservative and cleanup never deletes accepted attachments. Browser
acceptance additionally checks the native pagination control, keyboard/focus,
visible status and existing contrast styling on the integrated revision. Passing
local tests does not remove the runtime/production release gates.

### Browser acceptance — 9 September 2026

A real guarded Wrangler fixture served the portal and dashboard through their local
Vite proxies. The portal used a normally issued captured magic link; the operator
used its generated password and actual MFA. For bounded-history display, one portal
ticket was created normally and 51 synthetic historical articles were seeded into
that run-owned local D1 state. Those seed rows are fixture setup, not claimed
admitted mutations. Both views loaded 50 then 52 messages through real endpoints.

Keyboard activation of the final page preserved focus on the native completion
button. It has `aria-disabled=true` without a native `disabled` attribute; pending
and completed handlers prevent additional fetches. Both polite live regions
announced the completed count. Browser-computed text/white-background contrast was
17.74:1 for the portal and 17.85:1 for the dashboard. Bounded message visibility
values are booleans, avoiding a stray numeric display. This is keyboard and
accessibility-tree evidence; no human screen-reader session is claimed. #21 still
owns the complete workflow accessibility gate.

The local operator stopped intake at revision 2. Portal submission displayed the
stop message, retained the draft and left the accepted ticket visible. Resume at
revision 3 retained tickets=1, mutations=1 and upload_attempts=0. Existing portal
alert/focus behavior remains explicitly assigned to #21. The portal startup-login
race and UTC display discrepancy are assigned to #61; the local operator realtime
proxy is assigned to #62. None is excluded from the remaining beta gates.

Interactive Ctrl-C exposed incomplete temporary-directory cleanup after processes
stopped. The coordinator removed only the exact run-owned browser fixture directory.
The corrected launcher keeps its signal handlers installed while its idempotent
cleanup promise completes, so repeated npm/tsx or terminal signals cannot restore
Node’s immediate-exit behavior midway through cleanup. A new actual-PTY regression
then launched the supported `npm run fixture:local-beta --workspace=apps/server`
command twice, verified its guarded health and private credential file, and sent
single and repeated Ctrl-C. Both runs removed their exact temporary directory,
including state and credentials, released port 8787 and exited. Terminal output
was held in memory only. This corrected proof preserves the initial failure above
and does not retroactively claim that the original teardown succeeded.
