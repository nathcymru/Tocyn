# Operator handling of API and portal intake

Tocyn's dashboard lets an authenticated staff member handle the same scoped tickets
created through the API and customer portal. The server remains authoritative for
tenant membership, MFA, group access, assignment, message visibility and audit
history. The browser is a client of those operations; it does not supply a trusted
tenant identity or move application UI into the API Worker.

This is local implementation evidence for issue #62. The functional workflow has
executable and guarded local browser evidence. Actual screen-reader acceptance of
the changed controls remains an open criterion of #62; this delivery progresses the
issue and does not close it. This is not a remote deployment, external mail delivery
or production-readiness claim.

## Session and feed behavior

Each dashboard authentication session receives a fresh query cache and page state.
Changing credentials or authority cancels outstanding requests, clears the previous
cache and discards old drafts and realtime presence. Responses from an earlier
session cannot trigger downloads, replace current data or sign out the new session.
Only authentication state is persisted; the cache generation is not persisted and
credentials are not query keys. Ordinary display-name refreshes preserve the active
page; actual authority changes reset it.

The feed supports search, saved filters and page controls. A failed initial fetch is
reported as unavailable, rather than an empty result. A failed background refresh
retains the last confirmed results with a warning and a retry control. Rejected
ticket creation retains the draft and displays an inline error. The native create
dialog has a name, initial field focus and focus return when closed. Tickets with no
allocated human number display and copy their actual stored ID. No number is invented.

Realtime ticket/article events invalidate current-session feed and detail queries;
the client then reloads authoritative server data. Event payloads do not replace
query results. Both tracked local Vite configurations enable WebSocket forwarding
for the API proxy. This affects local development, not provider deployment.

## Ticket detail and recovery

Status, priority, assignment and group controls submit validated changes, retain focus while pending with
`aria-disabled` and synchronous action guards and display rejected changes without replacing confirmed
values. Unassigned and No Group send explicit null values. Committed audited changes
notify the existing tenant-scoped realtime channel; rejected writes do not.

Public replies and internal notes retain their draft and selected attachments after
a rejected request. Successfully uploaded attachment references are reused on an
explicit retry. The composer prevents concurrent submissions and remains read-only while
pending; attachment-only submissions remain disabled because the server requires
a message body. Success refreshes the feed and all loaded conversation pages.
The interface describes public visibility without promising external email delivery.

A failed initial detail read is distinct from a missing or inaccessible ticket. A
failed refresh keeps confirmed content with a retry action. An uncertain write is
not automatically resent: the retained draft warning directs the operator to refresh
the conversation before retrying. Navigating to another ticket resets its local
composer state. These dashboard writes do not gain an exactly-once guarantee.

Review caught three gaps in the initial detail approach: parallel uploads could
unlock retry before a sibling finished, native disabled controls lost focus, and
joining an old in-flight read could miss a committed update. The corrected code
awaits all upload outcomes, keeps focused controls with guarded actions, and
logically cancels obsolete reads before fetching current data. Deferred regressions
verify partial-upload retry, pending focus/edit guards and event/mutation overlap;
the earlier passing cases did not cover these races.

Touched controls use native buttons, associated labels, pressed-state semantics and
inline alert/status announcements. Static CSS uses dark slate/red text and brand or
dark amber button backgrounds; these checks do not constitute an application-wide
accessibility audit.

## Independent local browser subset

A root-agent browser session exercised the actual local Worker and dashboard on
8787/5173 with generated synthetic A/B staff credentials. Password and MFA navigation
worked. A created one ticket through the dialog; search and clearing search showed
the expected zero/one results. Logout followed by B password/MFA showed zero B tickets
and no A subject or draft, including after reload. After the proxy and invalidation
corrections, the browser displayed a connected realtime session and two B arrivals
without a manual reload. UUID fallback and named copy controls were observed.

The native dialog was modal, focused Subject initially and returned focus to New
Ticket after Escape. The browser moved focus to browser chrome after the last field;
this rehearsal does not claim a full Tab-cycle or an actual screen-reader session.
That earlier rehearsal was separate from the final guarded journey below. Both
owned process sessions were stopped, their temporary state and credential transfer
file were removed, and loopback bind probes confirmed all three local ports were free.

## Guarded operator browser journey

A fresh `fixture:local-beta` run exercised the actual local Worker and dashboard.
Setup added one synthetic UUID assignee/group to its disposable D1 state and created
one API ticket and one portal ticket through the supported authenticated routes.
The guarded policy and explicit invitations stayed enabled throughout handling.

After normal staff password/MFA login, the browser opened both tickets, assigned the
synthetic agent/group, changed state and priority, then cleared assignment/group.
The cleared values survived reload. Both tickets received one public response and
one internal note, then ended resolved with high priority in the feed. Each response
and note appeared once. The existing local operator control paused writes during
one public reply: the actual rejection appeared inline, the draft remained intact,
and Send Reply retained focus. After the operator resumed writes, one explicit retry
succeeded. No automatic resend or external delivery was claimed.

Four final API/customer retrievals across both tickets included the public response
and exposed no internal note. The measured policy counters were two tickets, twenty
mutations and zero upload attempts, with the policy running. The final visibility
verifier made seven HTTP requests, including customer authentication/capture; those
are not the total browser request count. The lower-level D1/R2 measurements below
remain a separate executable experiment.

The browser caught UTC timestamps displayed one hour early in BST. Dashboard now
uses the established UTC parser for SQLite timestamps before formatting conversation
time, opened dates and feed dates. Recent notes then matched the browser's 03:11 BST
clock. The focused regression also runs with `TZ=Europe/London`.

Actual browser observations included associated labels, action focus retention,
inline alert and polite conversation status. Computed send-button contrast was
5.65:1 (white on `#355cdc`); error contrast was 9.16:1 (`#7f1d1d` on `#fef2f2`). Fast
requests prevented a reliable browser observation of transient read-only state;
deferred component tests cover that behavior. These observations do not establish
screen-reader acceptance. That remains required under #62, and later integrated
#21 evidence may satisfy it without changing this criterion.

The browser tab and credential bindings were cleared. The supported fixture command
removed its run-owned state. An auxiliary private terminal wrapper encountered an
error during shutdown; state/process verification and credential-handoff removal
were then completed explicitly. Final bind probes confirmed 8787, 5173 and 5174 free,
with no owned fixture processes or handoff files remaining.

## Local executable handoff

The route rehearsal uses fresh migrations-backed Miniflare D1/R2 and the local-only
auth capture transport. It requests and verifies a real synthetic customer magic
link, performs staff password and MFA verification, and creates an actual scoped API
key through the existing fixture. It then:

1. Creates one API ticket and one portal ticket, and finds each in the staff feed.
2. Opens the initial message, assigns a synthetic agent/group, changes state and
   priority, then clears agent/group with explicit null values.
3. Posts a public response and an internal note, resolves the ticket, and reads back
   persisted values and audit events.
4. Retrieves the public response through both supported API and customer routes and
   checks that the internal note is absent.
5. Verifies foreign-tenant, invalid-input and revoked-session denials leave stored
   ticket/article/audit state unchanged. After discarding a committed response, it
   recovers by reading the ticket and observes one stored response; it does not
   automatically resend a dashboard write.

The initial measured two-ticket loop used 27 route requests after authentication and
fixture bootstrap, added three rows to the fixture's selected D1 counter (two
tickets plus one assignee), and stored zero R2 objects. This selected counter is not
a count of all database rows: it includes users, tickets and API keys only. The
positive loop took approximately 5.6 seconds on the final combined candidate; both route cases passed and
their disposable fixtures were released. These are observed local measurements, not
capacity estimates or browser request totals. External delivery is disabled by the
local profile; no provider-send counter is claimed.

From the repository root with Node 22:

```sh
npm exec --workspace=apps/dashboard -- vitest run src/__tests__/AuthQueryBoundary.test.tsx src/__tests__/AuthNavigation.test.tsx src/__tests__/TicketFeedWorkflow.test.tsx src/__tests__/LiveFeedWorkflow.test.tsx src/__tests__/TicketDetailWorkflow.test.tsx
npm run test:operator-workflow --workspace=apps/server
npm run typecheck:operator-workflow --workspace=apps/server
TZ=Europe/London npm exec --workspace=apps/dashboard -- vitest run src/__tests__/utcTimestamp.test.ts
npm run build --workspace=apps/dashboard
```

At this checkpoint the six new dashboard files contain 29 passing cases; the
accepted pagination regression also passes, for 30 dashboard cases in total. The
local route suite contains two passing cases. Full server 364, portal 19, widget 3
and repository 31 checks pass on this integrated source. The functional guarded
browser journey is recorded above. Actual screen-reader acceptance remains required
before #62 can be reported complete. Semantic component checks and the observed
native-focus subset do not imply an actual screen-reader audit.

Final integration uses signed portal prerequisite `58feb5e` with operator source
`8b322da`. Lint, all required typechecks and all three builds passed. The complete
test chain passed its upstream checks, then one existing guardrail runtime request
hit its five-second deadline. The unchanged isolated runtime and real-PTY launcher
checks subsequently passed; the remaining operator and portal runtime suites also
passed, and all local ports were released. No deadline was increased. This transient failure is
retained as a validation limitation, and required PR CI must pass before merge.

Existing lower-level evidence is recorded in the
[tenant-isolation matrix](security/tenant-isolation-acceptance.md),
[canonical conversation contract](architecture/canonical-conversation-contract.md),
[API retry contract](phase-1.4-api-spec.md), and
[conversation audit](architecture/conversation-audit.md).
