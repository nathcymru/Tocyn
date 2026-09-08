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
`tocyn-auth-test@example.invalid`; it never reads tenant Resend credentials,
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

This starts owned loopback Worker/portal processes, applies all 23 migrations to a
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
