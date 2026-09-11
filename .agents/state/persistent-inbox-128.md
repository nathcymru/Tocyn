# #128 persistent inbox — PR #219 receipt (11 September 2026)

Branch `codex/128-persistent-inbox`, draft PR #219. The source correction is
`ffb0109e56936103f941541cc14f880ef9f27bf8`.

This increment preserves the mounted inbox list's roving keyboard focus through
conversation route changes, and does not persist a new view before a pending
conversation draft permits navigation. The focused persistent-inbox suite had
98 passing tests at this revision; dashboard `tsc --noEmit` and the production
dashboard build also passed.

Guarded local-browser observations from the root-owned preview: 20 synthetic
tickets rendered; a fixture ticket was selected; support state and handler
rendered; an internal note returned 201; draft cleanup returned 204; and the
AX note was visible. The realtime proxy disconnected with 426 and the fixture
has no configured SLA. Actual spoken VoiceOver evidence is still pending.

This is partial #128 evidence only. Full #128 remains open and depends on #130
and the remaining workspace acceptance work. No preview, VoiceOver, provider,
or remote Cloudflare action was performed by this branch update.

## Integration refresh and recovery tests — 11 September 2026

Refreshed onto accepted PR210/main438cfff. Preserved accepted administration/runtime changes. A standalone Spark/medium worker prepared conflict recovery tests; root corrected incomplete setup and assertions, then verified13/13 workspace/inbox tests on this refreshed branch. Explicit restore retains confirmed selection and list/draft visibility, then permits subsequent navigation. Worker unfinished patch remains /private/tmp/tocyn-spark-workers/inbox-recovery-unfinished.patch. Spark stopped at its five-hour usage limit; no worker is claimed active. Exact refreshed CI is required before acceptance. Full #128/#140 remain open; shared #130 snooze is not implemented here. Guarded local preview5190 remains available with previously recorded limitations.
