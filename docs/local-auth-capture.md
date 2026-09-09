# Local authentication capture

The local server profile is a loopback-only development aid for #57. It binds
Wrangler to `127.0.0.1:8787`; use either `http://localhost:8787` or
`http://127.0.0.1:8787` for the API and capture controls. It has local D1, R2
and Durable Object emulation only. It does not connect to a Cloudflare account
or send provider email.

Start from synthetic local state:

```sh
cp apps/server/.dev.vars.example apps/server/.dev.vars
npm run db:migrate:local
npm run dev:server
```

Run the portal separately at `http://localhost:5174` and the dashboard at
`http://localhost:5173`:

```sh
npm run dev:portal
npm run dev:dashboard
```

The local Worker allows those two browser origins and their exact `127.0.0.1`
equivalents. Magic links target
the portal's `/verify` route at port 5174, so the portal performs the existing
customer verification request through its local API proxy.

Local state must not contain a Turnstile configuration. If a stale local
`TURNSTILE_SECRET_KEY` exists, authentication rejects the request without
decrypting the value or calling Cloudflare; a stale site key is omitted from
public local configuration so the portal cannot load the remote widget. With
no Turnstile configuration, the existing local synthetic fixture flow remains
available.

The local entry point injects an in-memory email transport into the existing
customer authentication service. That transport accepts only
`tocyn-auth-test@example.invalid`, `tocyn-auth-test-a@example.invalid`, and
`tocyn-auth-test-b@example.invalid`; it never reads tenant Resend credentials,
makes a provider request, or falls back to a provider transport. Messages are
kept for at most 15 minutes and ten entries. Inspect or clear them at:

- `GET http://localhost:5174/__local/auth-capture` (local portal UI)
- `GET http://localhost:8787/__local/auth-capture/messages`
- `POST http://localhost:8787/__local/auth-capture/reset`

The capture transport and JSON endpoints are constructed only by
`src/local-index.ts`. The browser page is a portal development-only route; it
is not part of the Worker bundle or normal deployment configuration. Requests
with any other host are rejected by the local entry point.

To exercise customer authentication interactively, use a synthetic
tenant and widget key, request a magic link for the exact `.invalid` address,
read the captured link, then submit its token to the existing customer verify
endpoint. The capture does not create users, challenges or JWTs; normal tenant
resolution, token storage, redemption and JWT signing remain in force. The
repeatable A/B principal provisioning work remains #58.

Do not put Resend keys, Cloudflare credentials, real recipients or production
data in `.dev.vars`. Remove `apps/server/.wrangler/` only after stopping the
local server if synthetic local state needs resetting.

## Disposable acceptance rehearsal

Stop the local servers first, then run from the repository root:

```sh
npm run test:local-auth --workspace=apps/server
```

This starts owned loopback Worker/portal processes, applies the complete checked-in migration chain to a
fresh temporary database and provisions minimal synthetic tenant configuration.
It exercises the real request, capture and verification handlers, wrong-tenant and
replayed-token rejection, hostile-origin reset rejection, and a Worker restart.
The authenticated identity survives restart; captured messages intentionally do
not. It also verifies portal serving and that the API does not serve capture HTML.
The helper removes its temporary credentials/state and owned processes on completion,
failure, SIGINT or SIGTERM. Existing developer state is never reset. Output contains
redacted outcomes, duration and disk measurements only. This is a disposable proof,
not #58's reusable interactive account provisioning.

The 8 September 2026 local run took 5.558 seconds; temporary state grew from
1,433,208 to 2,742,448 bytes. Two messages were captured; zero remained after restart.
These measurements describe this synthetic run, not a capacity limit. External mail
is disabled by transport construction; no measured external-request count is claimed.

Browser verification covered direct navigation/reload, keyboard focus and activation,
named main/region/headings, English document language and a live status announcement
in the accessibility tree. Controls use static CSS and visible native focus. The
primary white-on-blue text contrast exceeds 4.5:1. This is browser accessibility
inspection, not a claim that a human screen-reader session or the broader #21
accessibility acceptance has been completed. Focused tests also cover escaped message
rendering, reset, count/expiry bounds and absence from normal Worker routes. Production
portal build inspection excludes the development capture route/code.

No remote deployment, provider activation, production migration or rollback is proved
by this rehearsal. Local-only scope is the owner's current #57 target; the remaining
beta issue gates still apply.

## Reusable A/B local tenant fixture (#58)

The local capture rehearsal above proves the customer magic-link loop. The separate
#58 fixture creates two fresh synthetic tenant scopes and four password principals:
customer and administrator for each tenant. The customer and administrator local IDs
intentionally collide across tenants. Customer login addresses are the two approved
local capture aliases, while administrator addresses are distinct canonical `.test`
addresses because the current login index is global.

Run the disposable route-level verification from the repository root:

```sh
npm run test:local-tenants --workspace=apps/server
```

It creates an in-memory local D1/R2 fixture, applies all checked-in migrations, and
uses the existing authentication, MFA challenge/verification, dashboard API-key and
`/api/v1` handlers. It proves customer password and magic-link/widget authentication, administrator MFA,
wrong password/OTP denial, canonical-email collision rejection, A/B key metadata isolation,
read-only/revoked/malformed-key denial, and `PRAGMA foreign_key_check`. Its JSON
receipt contains counts and statuses only. The helper always disposes the in-memory
bindings; `npm run test:local-tenants:focused --workspace=apps/server` repeats fresh
runs and exercises failure cleanup.

For a human operator to inspect the same kind of fixture through the real loopback
Worker, use an interactive terminal only:

```sh
npm run fixture:local-tenants --workspace=apps/server
```

The command refuses CI, redirected output, extra arguments, and a busy port. It creates
a new temporary local state directory, applies migrations, starts only a local Worker
at `http://localhost:8787` bound to `127.0.0.1`, then reveals the four generated
synthetic passwords, each customer portal login URL with its public widget key, and
administrator TOTP enrollment URIs once to that terminal. It
never prints an API key, writes a credential export, changes existing `.wrangler`
state, starts a browser frontend, contacts a provider, or accepts a remote target.
Stopping it removes the run-owned state. Start the portal and dashboard separately
with the fixed-port commands above if their existing interfaces are wanted.

The administrator MFA secret is a fixture-only direct encrypted bootstrap because a
new administrator cannot reach the current normal MFA setup route before MFA has been
verified. This does not implement commercial onboarding or general MFA self-enrollment.
The fixture does not replace #19's broader cross-surface tenant-isolation matrix, #57's
local customer-mail capture proof, or #62's human ticket-handling workflow.

### #58 validation receipt (8 September 2026)

The route verifier passed with two tenants, four principals, MFA logins, real
same-ID tenant-scoped ticket reads, permission/revocation negatives and protected
credential storage checks. It also exercised both magic-link request/capture/verify
flows, wrong-tenant keys, widget-audience identity and replay denial. The final run
recorded 41 route requests, eight selected D1 rows (users, tickets and API keys), zero
R2 objects and zero foreign-key violations. These are measured fixture counts, not
total database operations or production capacity. Focused checks repeated fresh
fixtures and verified cleanup after an injected callback failure. Live role-change
rejection was tested; broader session-version/cross-surface acceptance remains #19.

An independent pseudo-terminal rehearsal exercised the actual interactive Wrangler
runner without printing credentials into its report. Each of two runs completed two
customer password logins and two operator MFA logins through HTTP. Tenant A's portal
magic-link flow ran in the first instance, tenant B's in the second; each proved
foreign-key rejection, widget identity and replay denial. Separate fresh runs kept
negative attempts below the unchanged five-verification-per-minute IP limit.
SIGINT exited130 and SIGTERM exited143; both released port8787 and removed owned
state. Runs took 5.36 and 5.50 seconds. Credentials stayed in rehearsal memory and
were discarded. #62 still owns the complete human handling workflow.

Both server and dedicated fixture-script typechecks pass; focused fixture tests,
server regressions and independent security review pass. Required CI now runs the
fixture-script typecheck, redacted verifier and repeated-run/failure-cleanup tests.
No browser authentication UI bypass, mail provider or remote resource was introduced.

## #61 disposable portal workflow acceptance

Run the end-to-end local Worker acceptance from the repository root only when
port 8787 is free:

```sh
npm run typecheck:local-portal-workflow --workspace=apps/server
npm run test:local-portal-workflow --workspace=apps/server
```

The runner creates a temporary Wrangler configuration, local D1/R2/DO state and
synthetic principals, then removes all of them when it completes or fails. It
enables the guarded local-beta profile and initializes its run-owned D1 state
through the existing local operator command with exactly the two fixture tenants
and their invited customer/staff principals; its mode-0600 policy file is then
removed. It uses the existing three-address capture allowlist and a real
magic-link request and redemption, rather than constructing a token. It verifies two tenant
customers, foreign challenge/detail denial, redeemed-link replay denial,
customer list and follow-up replies, MFA-authenticated operator replies,
customer detail/history retrieval, internal-note filtering, and both failed and
successful captured delivery. The failure occurs after its reply transaction
commits; the successful delivery reaches only the owning approved capture
recipient. No provider credentials are read and no external mail is sent.

The runner restarts only its own loopback Worker with a construction-time local
auth/capture/diagnostics clock. It proves the same clock is used for the captured
link, stored challenge expiry, signed widget JWT, normal JWT verification and
bounded local-beta diagnostics. This is not a global simulated clock: D1
`unixepoch()` behavior and beta admission, replay, mutation, or retention clocks
continue to use their normal local runtime semantics. It also
proves an expired 15-minute challenge, a separately revoked session, and a
seven-day expired widget session. The temporary clock and failure count exist
only in the runner-owned Worker startup configuration; there is no HTTP control
route or deployable binding for either capability.

The 9 September 2026 run completed in 11.58 seconds and reported four Worker
starts, 41 requests, nine selected D1 rows, five new articles and five new
conversation events. After the final expiry restart zero captured messages
remained; the earlier successful-delivery assertion checked one capture to the
owner, while the injected failure checked that none was recorded. Those are
disposal-run measurements, not capacity or production claims. The runner also
reports `cleanup: disposed`; it does not inspect or reset a developer's existing
state.

The final guarded browser check on `2add038` redeemed a locally captured link,
loaded tickets, and used **Sign out all sessions**. It returned to login without
a warning; a later navigation to tickets remained redirected to login. This
confirms the normal portal sign-out request has an empty body, revokes the
server session, and is not merely a local browser-token clear.

This exercise proves the server workflow only. Portal keyboard, focus, labels,
announcements and contrast remain owned by #21; it does not claim that broader
UI accessibility acceptance or beta deployment evidence.
