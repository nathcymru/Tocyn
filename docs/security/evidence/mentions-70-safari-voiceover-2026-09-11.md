# Durable internal mentions Safari/VoiceOver validation

Application revision: `950b85b4d43b0d5f3c5ba3499c6f8752d8c1cab3`. Local synthetic Miniflare/D1 and an ephemeral loopback forwarding server only. Owner ports 8787, 8899 and 5190 were untouched; disposable processes were stopped after testing.

## Successful browser journey

The fixture used 17 UUID-identified synthetic colleagues. Only its owner budget interval was extended to a bounded 30-minute window (observed duration 1,801,030 ms); grant lifetime, authority freshness and application limits were unchanged. This avoids expiration of the original one-minute fixture window during manual testing.

Safari's native accessibility tree exposed all 17 colleagues. Exactly 16 were selected, including Colleague 17; the remaining choice could not exceed the cap. After “Draft saved.”, reload restored the exact synthetic body, Internal Note mode and all 16 selections.

The first Add Note reached the deliberately injected uncertain response after the backend accepted the article. Safari retained the draft and exposed “Synthetic mention retry. Your draft is retained. Refresh the conversation before trying again if delivery is uncertain.” Manual retry exposed “Internal note added.”, one rendered internal note and a cleared composer.

Authorized VoiceOver AppleScript last-phrase readback returned: “You are currently on a button. To click this button, press Control-Option-Space.” Mention names and completion text are accessibility-tree observations, not independently captured spoken phrases. No claim is made that every picker label or status was spoken.

## Database and resource evidence are separate

The browser forwarding fixture had no database-count endpoint; this browser run does not prove exactly 16 durable rows. The separately executed real D1 tests in `apps/server/scripts/staff-ticket-mutation-runtime.test.ts` assert 16 recipient activities, one winning article under concurrent/retried requests, and rollback on recipient revocation. The coordinator's integrated staff runtime run passed 28/28, with a separate collision test passing 1/1. This distinction must remain in completion receipts.

Fresh Node 22/Vite 8.2.2 production manifest build, gzip level 9: 568,306 total JavaScript bytes, 101,795 initial JavaScript bytes, 15,860 CSS bytes. Gates remain 570,000/135,000/16,000.

## Earlier failed fixture attempts

- Prefixed synthetic colleague identifiers caused invalid-draft HTTP 400. Correct UUID identifiers produced draft PUT/GET 200; no product marker conversion was introduced.
- A handed-off process had already ended, producing connection refused. The final worker owned the live process through testing.
- The original short owner interval expired during manual testing, displaying budget exhaustion. Increasing mutation allowance alone did not fix it. The successful bounded-window run supersedes that failed attempt; no product admission bypass was used.

## Remaining scope

This is scoped browser and VoiceOver evidence, not full #70 or beta.2 acceptance. Interruption preferences remain required. ADR-0019 assigns persistent workspace preferences to #132; #70 must consume that contract without duplicating preference storage. Full #140 and production #42 remain separate gates.
