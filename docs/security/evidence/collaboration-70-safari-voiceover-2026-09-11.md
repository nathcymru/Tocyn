# Collaboration reply-recovery Safari and VoiceOver check

Observed 11 September 2026 on `06042c3` (then merged with accepted main
`f2e8edef412ced26e7320ffb5fd71de8a8a2d65b`) using Safari and the native
VoiceOver AppleScript dictionary. The dashboard production build ran against a
disposable loopback-only Miniflare/D1 fixture with two synthetic tenant-A
operators and a separate synthetic tenant-B identity. The fixture used its own
ephemeral port and test-only authenticated local session; it did not contact a
provider or remote service. The Safari test tab and fixture were removed after
observation. Owner ports and unrelated Safari tabs were left untouched.

## Observed recovery journey

Safari performed the real combined-capability journey: operator A saved a
public draft, operator B created a material public reply, and A's first Send
Reply received the server's stale-reply conflict. The visible native
accessibility tree exposed the retained draft, the disabled Send Reply control,
and the separate **Refresh and review conversation** action.

Selecting that action rendered operator B's exact `AT newer material` reply
before exposing **Rebase saved draft**. The draft stayed `AT stale draft`.
Rebase showed “Draft rebased to the reviewed conversation. Review the draft,
then send manually.” and only then re-enabled Send Reply. The separate manual
send added exactly `AT stale draft` as the second rendered conversation reply
and showed “Public reply added to the conversation.”

A subsequent synthetic lost-response attempt retained `AT lost response retry`
after the fixture's real admission boundary rejected the operation for capacity.
That attempt did not reach the planned post-commit 503 response, so it is not
lost-response/replay acceptance. The production-browser runtime regression
remains the evidence for the stable idempotency key and single stored reply in
that path.

## VoiceOver result and limit

The documented read is `get content of last phrase`; it worked and, after
moving the native VoiceOver cursor to the active Safari item, read the composer
instruction: “Type / for commands or : followed by an emoji name. Markdown
toolbar supports headings, emphasis, links, lists and code.” This is actual
VoiceOver spoken-output retrieval, not a DOM assertion.

Safari's native accessibility tree made each stale/review/rebase/manual-send
state readable and exposed their named actions, but this session could not move
the VoiceOver cursor through those specific recovery notices: the documented
directional cursor form was rejected by the local AppleScript bridge, and the
last-phrase value remained the web-content group instruction after CUA actions.
No unsupported command or setting bypass was attempted. Therefore this is
limited Safari interaction and composer-spoken-label evidence, not spoken
confirmation of the stale error, refreshed material, rebase status, manual-send
status, or lost-response retry. Full assistive-technology acceptance remains
open.

The separate local browser fixture test continues to cover the two-tenant
collision/review/rebase/manual-send and lost-response retry protocol paths; it
is complementary and does not replace the missing VoiceOver traversal.
