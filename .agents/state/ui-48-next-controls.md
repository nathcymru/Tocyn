# #48 remaining-control queue

Read-only inventory completed by the resumed evidence_copyedit worker10September2026, coordinator checked the cited current source locations. No implementation or acceptance closure is implied. Model/effort metadata was unavailable on resume; no separate allowance or model switch is claimed. Worker is complete; coordinator retains integration ownership.

| Area | Source | Next action / scope |
|---|---|---|
| Account disclosure | apps/dashboard/src/components/layout/Layout.tsx, UserMenu | Migrate retained disclosure/menu behavior; verify keyboard opening/dismissal, focus return and accessible state. Preserve sign-out failure handling. |
| Connection disclosure | apps/dashboard/src/components/layout/Layout.tsx, showConnDetails | Shared popover composition and focus/dismissal parity; preserve connection/retry semantics. |
| Ticket-detail QA actions | apps/dashboard/src/pages/TicketDetailPage.tsx, QA Toggle Buttons | Remove hover-only visibility for retained actions; verify labels, target size and focus. |
| Live-viewer context | apps/dashboard/src/pages/TicketDetailPage.tsx, title-based presence indicators | Accessible names/status/tooltip behavior without inventing additional presence data or weakening tenant boundaries. |
| Widget launcher/panel/tabs | apps/widget/src/App.tsx | Name controls, establish disclosure/tab/focus semantics and preserve mounted interaction state. #67 owns wrapper lifecycle/isolation separately. |
| Widget chat | apps/widget/src/components/AiChat.tsx | Name send control, expose message/loading/error announcements and verify pending/retry/focus behavior. Do not change AI execution authority. |
| Widget ticket form | apps/widget/src/components/TicketForm.tsx | Associate labels and establish success/error/submission announcements, focus and retry evidence. |
| Ticket-row action menu | apps/dashboard/src/pages/TicketListPage.tsx, openMenuId | Only retained interactions need parity. Obsolete table composition is replaced under #128; do not reproduce it as a prerequisite. |

This inventory supplements the retained-behavior matrix; it is not an exhaustive closure checklist. Remaining email add/provider settings and security-profile controls, browser/VoiceOver/target-size/reduced-motion validation, edge-safe imports and measured bundle/startup/interaction budgets remain #48 acceptance. #66 themes and #67 embedding keep separate ownership. All checks must be tied to the revision actually tested.

Checkpoint10September18:26BST: widget launcher/tabs/chat/ticket-form implementation and regression coverage are now in PR167 (64e55f0), with browser/performance acceptance pending. Account/connection disclosures now use shared Ark Popover and pass layout regressions, including explicit destination focus and sign-out failure. Treat those rows as validation queues, not unimplemented code. Remaining ticket-detail/retained row controls, email/security controls and full cross-client acceptance still apply.
