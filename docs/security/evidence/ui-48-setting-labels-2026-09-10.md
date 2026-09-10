# Remaining retained control labels — 10 September 2026

A coordinator source sweep found unassociated labels in Automation, Usage and ticket custom fields. These are in-scope #48 defects and were corrected rather than excluded from acceptance.

Automation now connects Rule Name, Trigger Event, Action Type, Webhook URL, HTTP Method and Retention Period labels. Status toggles have names and pressed state; editor close, condition field/operator/value/removal and list status controls have explicit names. Usage associates both account and masked-token labels. Ticket custom fields use instance-scoped label/control IDs for text, textarea, select and checkbox; their label contrast was strengthened. The suggested-reply dismissal also has an explicit name.

Native Safari/VoiceOver on the local synthetic automation page announced Rule Name, Trigger Event, Action Type, selected Rule status, Webhook URL and HTTP Method. No rule was saved, toggled on the server or executed. The same spoken inspection exposed the unnamed editor close button, subsequently fixed with a regression assertion. This is scoped naming/traversal evidence, not complete final-source AT or provider execution proof. Safari returned to the local ticket; VoiceOver remains enabled.

Focused regressions cover the automation labels/status/conditional retention fields and condition addition/removal; Usage missing-configuration form labels without credentials or a write; and all four ticket custom-field types. Final PR revision still requires CI/security and integration acceptance.

Source SHA-256:

- `apps/dashboard/src/pages/AutomationPage.tsx`: `0803178a5216edea8b32e8f644c63114c6c5256232240d1fe7c1eed6aae7b876`
- `apps/dashboard/src/pages/UsagePage.tsx`: `2b1a8d46e02362fec2458b7b2c1431c3045ac3d6c14b460c37380ded2f394c3b`
- `apps/dashboard/src/pages/TicketDetailPage.tsx`: `ddcfd1f7d82352bd7a381cb154ef49aba53ef69443bf13598d2783032be69360`
