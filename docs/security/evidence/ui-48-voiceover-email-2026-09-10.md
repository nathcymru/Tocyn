# Email settings VoiceOver evidence

Observed 10 September 2026 in Safari 27/macOS 27 with owner-authorised native VoiceOver navigation/actions and spoken-output reading. Candidate UI: local port 5190; synthetic fixture backend: 8899. EmailChannelPage.tsx source blob: `4e2c7995a4a3a51d8a036ac7c9337d14509ee867`, candidate revision `19b9bbdcfce02b682be683bf71af8a550ea9300c`.

VoiceOver announced the named Outbound email configuration form, Resend Integration heading, secure API-key field, required Default From Email field, disabled Save Configuration button and explanation that receiving email requires a separately configured provider. No field values were entered, copied or saved.

VoiceOver activated Add Email. Focus moved to the required Email Address field in the named Add support email form. Traversal announced Display Name, Assign to Group collapsed pop-up, its routing explanation, the unchecked default-outbound checkbox and Save Email. VoiceOver then activated Cancel; focus and spoken output returned to Add Email. No channel was created and no mail/provider request was made by this test.

This proves the observed labels, navigation, opening and cancellation only. It does not prove submission, failed-save recovery, group selection, provider connectivity, contrast or full screen-reader acceptance. The backend is the existing synthetic UI fixture, not the latest observability branch. VoiceOver remains owner-enabled; no access setting was changed.
