# Collaboration reply-recovery Safari and VoiceOver check

Initial spoken observations were made 11 September 2026 on functional recovery
revision `369c662` using Safari and the native VoiceOver AppleScript dictionary.
The final fresh production build at merge revision `e538af9` (including accepted
branding) was then rerun through the same Safari recovery journey and exposed the
same named stale-review, rebase, manual-send, and retry controls in its native
accessibility tree; its window title was `Tocyn Operator`. The dashboard ran
against a disposable loopback-only Miniflare/D1 fixture with two synthetic tenant-A operators and a
separate synthetic tenant-B identity. The fixture used its own ephemeral port
and a test-only authenticated local session; it did not contact a provider or
remote service. Owner ports and unrelated Safari tabs were left untouched.

## Observed recovery journey

Safari performed the real combined-capability journey: operator A saved a
public draft, operator B created a material public reply, and A's first Send
Reply received the server's stale-reply conflict. The visible native
accessibility tree exposed the retained draft, the disabled Send Reply control,
and the separate **Refresh and review conversation** action. VoiceOver spoke: “The saved draft or conversation changed. Review and rebase before sending; your draft is retained.”

Selecting that action rendered operator B's exact `AT newer material` reply
before exposing **Rebase saved draft**. VoiceOver spoke: “The latest
conversation is shown below. Review it, then rebase the saved draft when
ready.” The draft stayed `AT stale draft`. Rebase visually exposed “Draft
rebased to the reviewed conversation. Review the draft, then send manually.”
and only then re-enabled Send Reply. The subsequent separate manual send added
exactly `AT stale draft` as a rendered conversation reply and showed “Public
reply added to the conversation.”

A synthetic lost-response attempt retained `AT lost response retry`; VoiceOver
spoke: “Synthetic lost response. Your draft is retained. Refresh the
conversation before trying again if delivery is uncertain.” Retrying stored
that reply once, rendered three total messages, and cleared the composer. The
post-action VoiceOver last-phrase reads for rebase and successful sends were
later ordinary status/count messages (“Draft saved.” and “Showing 3 messages.
All messages are loaded.”), so this receipt does not treat the visual
completion strings as separately observed spoken output.

## Synthetic admission window and limits

A short-lived fixture policy (60 seconds) had expired during the earlier
human-paced attempt. Native interception proved the expired direct-combined
path returns 429 with zero grants and zero articles; a fresh direct
`off`-to-`combined` admission returns 201. Before this run's first budgeted
request only, the disposable fixture extended every existing policy window to
30 minutes. It retained all dimension limits, recovery percentage, 60-second
grant lifetime, 60-second authority age, and direct combined setup. This is a
fixture timing correction, not a product policy or capacity change.

## Build and scope limits

The earlier 570,181-byte result was a Node default gzip-level-6 exploratory
measurement, not the repository resource policy. A fresh Node 22.19 production
manifest build evaluated by `tools/ui-performance/bundle-evidence.mjs` at its
policy gzip level 9 measured 569,285 total dashboard JavaScript gzip bytes,
100,905 initial JavaScript gzip bytes, and 15,603 CSS gzip bytes. These remain
within the unchanged 570,000, 135,000, and 16,000 limits respectively.

This is partial local accessibility evidence. The final branded build exposed
the stale conflict and rebase completion strings in Safari's native
accessibility tree. Exact VoiceOver phrases above were captured on the unchanged
functional recovery revision before the branding merge; after the final reload
the VoiceOver cursor remained on the text area, so its action notices were not
claimed as fresh spoken output. The bounded multi-page stale-review regression
is covered by the focused dashboard test rather than this single-page fixture.
It does not establish whole-issue assistive-technology acceptance, durable
mentions, interruption preferences, deployment, or beta.2 readiness.
