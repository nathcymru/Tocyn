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

The command refuses a dirty or mismatched source revision. It creates a
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

The current increment records fallback as `not-run` until the compatible
same-state local-runtime probe is implemented and accepted. It does not claim
final candidate acceptance.

The receipt is redacted and records only revisions, command names/results,
durations, artifact manifest totals/digest, the local-only mode, and cleanup.
It excludes credentials, capture content, recipient identities, tokens, local
state, logs, and provider receipts. This is not a deployment, provider rollback,
backup/restore, migration reversal, or production readiness claim.

The focused lifecycle regression sends repeated terminal `Ctrl-C` through a
pseudo-terminal to an npm-launched fixture. It verifies that the fixture's owned
nested child and runner state are gone while an unrelated process remains alive.
It is a controlled interruption check, not a final candidate rehearsal.
