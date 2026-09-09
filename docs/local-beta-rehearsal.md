# Local private-beta rehearsal

Issue #65 provides a local-only reproducibility command. It produces two
independently checked-out `park` artifacts from one declared, clean immutable
revision and compares every artifact file byte-for-byte. It uses the existing
release preparation and artifact verifier, local Wrangler dry runs, synthetic
configuration, and no provider credentials.

Run it only after the owner identifies the accepted candidate and known-good
revisions and authorizes a final rehearsal:

```sh
npm run rehearse:local-beta -- --revision <candidate-40-character-sha> \
  --known-good <known-good-40-character-sha> --receipt /absolute/path/receipt.json
```

The command refuses a dirty or mismatched source revision. It creates a
runner-owned temporary root, keeps Wrangler configuration/cache and temporary
files beneath that root, clears provider credentials, and removes its generated
checkouts, build outputs and local state. It never sets `HOME`, invokes remote
Wrangler options, finalizes an artifact, publishes Pages, reads provider
resources, calls a rollback verifier, creates a tag, or creates a release.

`park` artifacts are source/package evidence only. They deliberately have no
application route and cannot prove local application behavior. The separate
code-fallback check must start the candidate and known-good **actual local
runtime fixtures** against the same nonempty synthetic conversation state where
their schema contracts are compatible. If that compatibility check cannot run,
the rehearsal must fail closed and record code fallback as unavailable; a fresh
empty application is not rollback or data recovery evidence.

The receipt is redacted and records only revisions, command names/results,
durations, artifact manifest totals/digest, the local-only mode, and cleanup.
It excludes credentials, capture content, recipient identities, tokens, local
state, logs, and provider receipts. This is not a deployment, provider rollback,
backup/restore, migration reversal, or production readiness claim.
