# Local private-beta rehearsal

Issue #65 provides a local-only reproducibility command. It produces two
independently checked-out `park` artifacts from one declared, clean immutable
revision and compares every artifact file byte-for-byte. It uses the existing
release preparation and artifact verifier, local Wrangler dry runs, synthetic
configuration, and no provider credentials.

The candidate checkout runs the focused acceptance matrix once. Both isolated
checkouts build and verify an artifact, so the comparison still detects an
unstable package result without repeating the same-SHA acceptance commands.

Run it only after the owner identifies the accepted candidate and known-good
revisions and authorizes a final rehearsal:

```sh
npm run rehearse:local-beta -- --revision <candidate-40-character-sha> \
  --known-good <known-good-40-character-sha> --receipt /absolute/path/receipt.json
```

The runner supports macOS and Linux with Node 22 and Python 3 with its `pty` module; other platforms are refused before work begins. The command refuses a dirty or mismatched source revision. It creates a
runner-owned temporary root, keeps Wrangler configuration/cache and temporary
files beneath that root, starts from a small system-runtime environment
allowlist, and removes its generated checkouts, build outputs and local state.
It preserves `HOME` and `PATH`, but does not inherit provider credentials,
application configuration, or arbitrary caller variables. It never invokes remote
Wrangler options, finalizes an artifact, publishes Pages, reads provider
resources, calls a rollback verifier, creates a tag, or creates a release.

Frontend builds receive only the recorded nonsecret values
`VITE_API_URL=https://api.beta.local.invalid` and
`VITE_WIDGET_KEY=local-rehearsal-widget-key`. Any inherited `VITE_*` value is
cleared before those values are pinned, so an operator URL or widget key cannot
silently enter both compared artifacts.

`park` artifacts are source/package evidence only. They deliberately have no
application route and cannot prove local application behavior. The separate
code-fallback check must start the candidate and known-good **actual local
runtime fixtures** against the same nonempty synthetic conversation state where
their schema contracts are compatible. If that compatibility check cannot run,
the rehearsal must fail closed and record code fallback as unavailable; a fresh
empty application is not rollback or data recovery evidence.

The runner prepares a third clean known-good checkout and its locked local
dependencies, then invokes the [same-state local-runtime probe](./local-beta-same-state-fallback.md)
as an owned child. It fails if the probe is unavailable or cannot preserve the
authorized canonical history and durable counters. This implemented path still
requires an actual accepted-candidate rehearsal; source tests alone do not
claim final candidate acceptance.

The receipt is redacted and records only revisions, command names/results,
durations, exit codes/signals, artifact manifest totals/digest, the local-only mode, and cleanup. Command labels come from fixed known step names; raw arguments and absolute checkout/tool paths are never serialized.
It excludes credentials, capture content, recipient identities, tokens, local
state, logs, and provider receipts. Child output remains suppressed because fixture output can include generated private credentials; failures retain the safe step label and exit status rather than inheriting raw output. This is not a deployment, provider rollback,
backup/restore, migration reversal, or production readiness claim.

The focused lifecycle regression sends repeated terminal `Ctrl-C` through a
pseudo-terminal to an npm-launched fixture. It verifies that the fixture's owned
nested child and runner state are gone while an unrelated process remains alive.
It is a controlled interruption check, not a final candidate rehearsal.

The runner owns each command or long-running service through a separate private
process registry. A tooling-only Node preload records Node processes and their
spawned tools, including detached Wrangler/workerd/esbuild descendants. It also
preserves trusted child loader options (for example, the TypeScript loader).
The registry contains only PID, parent/group IDs and OS start identity, with a
4,096-record and 128-command bounds, private directory/file modes and no command payloads or
credentials. Linux uses kernel start ticks; macOS `ps` reports start times to
second precision, so its reuse detection is coarser and is not an atomic kernel
process handle. The tooling is outside application imports and release assets.

Stopping a service first closes its spawn scope and waits for in-progress spawn
registration, then verifies process identities before bounded TERM/KILL cleanup. Each stop
has a ten-second verification deadline (individual OS inspections also time out).
Parent exit does not release its descendants. A service stop preserves shared
fixture state for the next code revision; final cleanup removes state only after
all scopes settle. Unverifiable ownership or failed shutdown leaves cleanup
`incomplete` and retains the private task directory for recovery. A successful
service stop is recorded as `stopped`, not as passed application acceptance.

The strengthened focused suite also covers non-cooperating nested processes
through real npm/PTY interruption, a leader exiting before detached and
same-group descendants, a late spawn attempted during shutdown, a service
restart against retained task state, and incomplete-registration retention.
These are bounded lifecycle checks; the actual Wrangler interruption and final
candidate rehearsal remain separate evidence. Earlier cooperative-only cleanup
coverage did not catch the forced-parent-exit defect and was strengthened.

Run the real local Wrangler interruption regression only while the owner has
reserved port 8787 for this task:

```sh
npm run test:rehearsal-interruption
```

It creates fresh local configuration/state, waits for local health, verifies an
actual workerd process is registered, interrupts the npm/Node/Wrangler tree
through a pseudo-terminal, and checks tree/state removal and port release while
an unrelated sentinel survives. It does not seed remote or existing state.

The bounded actual interruption check passed on macOS with Node 22 in 6.2s:
local health returned 200, seven owned processes included the real workerd
engine, repeated npm/PTY Ctrl-C disposed the tree and private state, port 8787
was reusable, and an unrelated sentinel remained alive. This is lifecycle
evidence only. The [same-state runtime evidence](./local-beta-same-state-fallback.md)
is recorded against its own clean candidate; the complete final two-artifact
and acceptance-matrix rehearsal remains unrun.

POSIX lifecycle execution cases are skipped on unsupported test hosts, while
the platform refusal contract remains tested without changing host identity.
Windows execution was not performed for this change; the rehearsal runner does
not claim Windows support.

The generic test suite explicitly skips the optional PTY case when Python/pty
is unavailable and reports the reason in TAP. The explicit interruption command
and full rehearsal reject that missing prerequisite before creating task state;
a skipped test cannot become completed interruption evidence. Static fixture
programs receive their paths and options as argument/environment data, never
interpolated executable source. The revised static-fixture interruption program was then rerun on macOS/Node 22:
one completed test, zero skipped, 4.0 seconds, health 200, seven registered
processes including workerd, disposed state/tree, reusable port 8787, and the
unrelated sentinel preserved. An independent bind probe passed and no owned
Wrangler task directories remained. The tested static fixture SHA-256 is
`3618e4d5985b6f93ba0fb68853dc8d13042f8271ae132322bbfc3c2f48a8f347`;
the earlier 6.2s run remains separate historical evidence.
