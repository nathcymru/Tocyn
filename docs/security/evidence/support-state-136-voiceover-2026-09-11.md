# Local waiting-state keyboard and VoiceOver evidence

Observed 11 September 2026, approximately04:15–04:21 BST, against PR177 application revision `3ba4537bf54f8b676a108f253e50613b532a904d`, its existing production dashboard build and actual disposable Worker/D1 two-tenant fixture. Safari and VoiceOver ran on the owner Mac with explicitly authorized AppleScript navigation and System Events keyboard access. The fixture used an ephemeral loopback port, synthetic operator MFA, local-only captured authentication and guarded mutation limits. No provider or remote resource was used.

## Observed acceptance

- VoiceOver exposed “Manage support state button”, the Support state form/heading and the customer-visible label separately from the staff-only explanatory text.
- The native selector announced “Waiting on customer (pending) Support state … collapsed pop-up button”. Keyboard Down/Return changed its selection.
- Waiting reason and Next action changed from optional to required in VoiceOver output.
- Keyboard entry supplied synthetic reason and next action; Tab moved between fields and onto “Save support state button”. Space activated Save. The VoiceOver cursor remained on Save after activation.
- Safari accessibility read-back showed Pending status, customer label “We need your reply”, the selected waiting definition and both exact entered synthetic values. VoiceOver navigation read “Support state saved.” This proves discoverable spoken feedback; the delayed phrase capture does not assert that an automatic live announcement was captured.
- The owner keyboard-access change is confirmed: System Events commands completed successfully. An initial Escape command succeeded before form interaction; this is not a claimed form-dismissal behavior (the form is inline).

The reproducible automated counterpart is `apps/server/scripts/ui-support-state-browser.test.ts`: production browser/real D1, page-two definitions, two writers, stale revision, retained input, explicit refresh/retry, customer-private projection, tenant isolation, bounded local mutation accounting and zero external requests. Required CI run34556942942 passed on the application revision above. Later documentation-only changes require their own final checks.

The temporary local helper and Safari test window are removed after evidence capture; VoiceOver remains enabled. This is local acceptance, not deployment, production or beta.2 clearance. Full SLA remains #73; routing remains #137.
