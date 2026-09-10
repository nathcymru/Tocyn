# Local widget VoiceOver evidence — 10 September 2026

Owner-authorised Safari/VoiceOver navigation inspected the production widget IIFE in a local synthetic host on 127.0.0.1:5191. All non-GET requests were rejected; configuration and session reads were synthetic. No message was submitted, account changed or external provider contacted.

Observed spoken controls and states:

- “Open support collapsed button”; activation moved to “Close support button Synthetic support group”.
- Named “Support options tab group”, “AI Chat selected tab, 1 of 2” and “New Ticket tab, 2 of 2”.
- Activating New Ticket exposed “New Ticket tab panel” and “Submit a support ticket form”.
- Your Name, Email Address, Subject and Message were named, with required state; Send Message was announced as a button.
- Activating the close control returned to “Open support collapsed button”.

The empty required fields were also announced as invalid by this browser before submission. This is observed native validation state, not evidence of submission or server rejection. AI-off, submitted recovery, visual contrast and arbitrary host integrations are not established by this spoken run; separate automated browser receipts cover AI-off and synthetic recovery.

Provenance: parent revision `533850e57b91a4c01cbde8fe12e4b0ef004b525d`; App source blob `508033650113405caaa4bc0b383f37767cbdeb95`; TicketForm source blob `05e8a8d072747bd822672fc63d33a4113db9ba5d`; served IIFE SHA-256 `5706e5253cc0ad030be8cc27f547a8d407484387e31d05249761411a4a93aa72`. Safari 27/macOS 27, owner-enabled VoiceOver; this scoped artifact receipt is not final integrated acceptance.

The temporary server was stopped, Safari returned to the existing local ticket fixture and VoiceOver remained enabled.


## Recheck after compiled shadow styles correction

The corrected built widget was read again in Safari/VoiceOver on 10 September. Launcher/open focus, named tabs and selected state, the ticket form and each required field, Send Message, and close/focus return passed. Uppercase visual labels remain correctly named. No fields were entered or submitted. Temporary5191 server stopped, Safari restored5190, VoiceOver left enabled.

Parent revision `ec3eb3c5f0617d78de68904498789371a67412c8`; dirty widget source and served artifact are identified by the companion `ui-48-widget-visual-ec3eb3c.json` receipt. Served IIFE SHA-256 `c68713900e4e7defe360af35ca35b825e45ae5e26dce8f42215d2bc0dcfb587c`. This supersedes the earlier unstyled artifact for the recorded spoken controls, while preserving its historical evidence. Final integration still requires its own checks.
