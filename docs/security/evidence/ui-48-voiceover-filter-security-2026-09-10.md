# Filter and mandatory-MFA VoiceOver evidence

Observed10September2026 in Safari27/macOS27 using native VoiceOver cursor navigation and spoken-output reading. Local candidate127.0.0.1:5190, synthetic fixture8899; no external providers. Source blobs: FiltersSettingsPage.tsx33e8e3926f7d63731d528fc4bb286f02c62385a0; SecurityProfilePage.tsxef6a311f8f718d7e919e4b12c1b6fb08b2783c42.

## Filter editor

VoiceOver activated Create Filter and traversed its title, named form, required Filter Name input/placeholder, Conditions section, Add Condition and the explanation that no conditions match all tickets. After activating Add Condition, it announced:

- Status, Condition1field, collapsed pop-up button.
- Equals, Condition1operator, collapsed pop-up button.
- Condition1value, edit text, with Value placeholder.
- Remove condition1 button.
- Cancel and Create Filter buttons.

VoiceOver activated Cancel and announced Create Filter button on return. No filter was submitted; the added condition existed only in an unsaved draft. The accessibility tree independently showed the condition controls and Cancel focus before cancellation. This does not exercise saving, errors, condition removal or keyboard trapping.

## Mandatory MFA presentation

On the synthetic mandatory-MFA operator's Security Profile, VoiceOver announced the two-factor heading, enabled status and “Two-Factor Authentication is mandatory for your role and cannot be disabled.” No authentication setting or credential was changed. Enrollment, error recovery, optional disabling and session-change behavior retain separate browser acceptance; unit regressions are complementary evidence.

Native VoiceOver remained owner-enabled. No access setting was changed. These observations advance #48; they do not claim all screen-reader, contrast, full application or beta.2 acceptance.
