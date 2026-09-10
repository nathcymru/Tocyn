# Answer/SOP compatibility spoken evidence

Observed10September2026 with owner-enabled VoiceOver and Safari27/macOS27. The production dashboard was served from an ephemeral loopback5191fixture; its three synthetic ticket reads displayed Answer, SOP and legacyQuestion. Non-GET requests were rejected; other reads used the existing local synthetic8899fixture. No marker was changed or message sent. The temporary server was stopped and Safari returned to5190 afterward; VoiceOver remained enabled.

Spoken output:

- Answer fixture: “Mark as SOP (internal procedure) toggle button”, “Mark as answer selected toggle button”, “QA marked”.
- SOP fixture: “Mark as SOP (internal procedure) selected toggle button”, “Mark as answer toggle button”, “QA marked”.
- LegacyQuestion fixture: the compatibility-review explanation, followed by both controls announced as dimmed toggle buttons. ExistingQuestion was not silently relabelled or converted.

TicketDetailPage source blob: `1acdc4d4f678c51a85d2969374864c0f48c5e712`. This is scoped spoken-label/state evidence, not a final integrated artifact attestation. It does not prove write/retry behavior, public retrieval, tenant isolation, viewer presence or full visual/AT acceptance. Browser computed-state evidence is separately recorded in ui-48-ticket-qa-cfa5df2.json; mergedPR172 owns server marker validation.
