# Retained behavior migration matrix

This matrix is the #48 migration boundary after #127. It accounts for retained base behavior without reproducing obsolete page composition.

| Existing behavior | Shared primitive target | Migration disposition |
|---|---|---|
| Buttons, links and icon actions with focus/disabled/loading states | `TocynButton` plus static focus/target tokens | Retain behavior; replace local styling gradually. Critical actions remain labelled and keyboard reachable. |
| Text inputs and search fields | `TocynInput` plus explicit search-scope composition | Retain behavior; global search and view filtering remain distinct under #127. |
| Ticket list/table selection and pagination | `Listbox`/`Combobox` Ark exports plus `ConversationList` shell | Migrate retained selection/recovery; table becomes secondary under #127. |
| Dialogs, menus and panels | Ark `Dialog`, `Popover`, `Splitter` and `TocynPanel` | Retain semantics; replace ad hoc focus/escape behavior after parity tests. |
| Dashboard/portal/widget standalone login and ticket/settings screens | Package primitives imported by each Vite browser build | Preserve standalone routes; no custom-element registration required. |
| Widget Shadow DOM/IIFE packaging | Browser-only package consumed by widget build | Keep UI package out of Worker imports; #67 wrapper lifecycle remains separate. |
| Error, retry, public/internal, attachment and tenant-safe data behavior | Primitive state/event contracts only | Preserve in consuming applications; #48 does not own domain state or authorization. |

Remaining application adoption includes complex dialogs/menus. The accepted #79 permissions page now uses shared native buttons/inputs while preserving its recovery and accessibility behavior. Non-goals for this slice: workspace routing, durable drafts, snooze/waiting state, permissions, tenant policy, theme persistence and wrapper packaging.

## Native-control adoption receipt

Dashboard, portal and widget now consume named button/input/select/textarea primitives through the narrow `@luminatick/ui/primitives` entry point. Native props, form semantics, refs, controlled/uncontrolled values, caller ARIA and event handlers are retained. Dashboard module resolution follows its Vite bundler so package export contracts resolve consistently. Widget token CSS is injected into its ShadowRoot; this does not claim completion of the separate wrapper packaging issue #67.

Validation at this increment: all three production builds; 73 dashboard, 59 portal, 3 widget and 6 shared UI tests pass. Tests include actual keyboard activation, dialog Escape/focus restoration, listbox keyboard selection, form serialization and caller busy-state retention. These DOM tests do not substitute for the remaining browser/assistive-technology acceptance or measured startup/interaction performance. Existing dashboard large-chunk warning remains; no threshold was weakened.

Remaining: Ark complex-control adoption and behavior parity, complete browser accessibility/target sizing checks, baseline-versus-candidate bundle/startup/interaction measurements, and cross-application visual validation after shared styling. Issue #48 and PR #167 remain incomplete.

| Source surface | Adopted native controls | Remaining raw form controls |
|---|---:|---:|
| `apps/dashboard/src/components/layout/Layout.tsx` | 9 | 0 |
| `apps/dashboard/src/pages/AgentPermissionsPage.tsx` | 3 | 0 |
| `apps/dashboard/src/pages/ApiKeyPage.tsx` | 7 | 0 |
| `apps/dashboard/src/pages/AutomationPage.tsx` | 21 | 0 |
| `apps/dashboard/src/pages/EmailChannelPage.tsx` | 11 | 0 |
| `apps/dashboard/src/pages/FiltersSettingsPage.tsx` | 12 | 0 |
| `apps/dashboard/src/pages/GroupsPage.tsx` | 13 | 0 |
| `apps/dashboard/src/pages/KnowledgeEditorPage.tsx` | 5 | 0 |
| `apps/dashboard/src/pages/KnowledgePage.tsx` | 10 | 0 |
| `apps/dashboard/src/pages/LoginPage.tsx` | 3 | 0 |
| `apps/dashboard/src/pages/MfaPage.tsx` | 3 | 0 |
| `apps/dashboard/src/pages/SecurityProfilePage.tsx` | 5 | 0 |
| `apps/dashboard/src/pages/SettingsPage.tsx` | 10 | 0 |
| `apps/dashboard/src/pages/TicketDetailPage.tsx` | 27 | 0 |
| `apps/dashboard/src/pages/TicketFieldsPage.tsx` | 10 | 0 |
| `apps/dashboard/src/pages/TicketListPage.tsx` | 18 | 0 |
| `apps/dashboard/src/pages/UsagePage.tsx` | 7 | 0 |
| `apps/dashboard/src/pages/UsersPage.tsx` | 5 | 0 |
| `apps/dashboard/src/pages/WidgetChannelPage.tsx` | 4 | 0 |
| `apps/portal/src/components/Layout.tsx` | 1 | 0 |
| `apps/portal/src/pages/LocalAuthCapturePage.tsx` | 2 | 0 |
| `apps/portal/src/pages/LoginPage.tsx` | 4 | 0 |
| `apps/portal/src/pages/TicketDetailPage.tsx` | 9 | 0 |
| `apps/portal/src/pages/TicketListPage.tsx` | 6 | 0 |
| `apps/portal/src/pages/VerifyPage.tsx` | 3 | 0 |
| `apps/widget/src/App.tsx` | 4 | 0 |
| `apps/widget/src/components/AiChat.tsx` | 2 | 0 |
| `apps/widget/src/components/TicketForm.tsx` | 6 | 0 |

### First complex-control adoption

The portal create-ticket modal now uses shared Ark dialog focus trapping, Escape handling and focus return. Submission locks dismissal while preserving draft/error recovery. Portal59tests, UItypecheck, portal lint/build passed. JSDOM requires a documented nonzero-layout fixture for Ark focusability; this does not claim actual browser visibility/focus containment. Remaining dashboard dialogs/menus and browser validation stay open. Portal candidate build after this adoption: JavaScript308.86kB (gzip98.21kB), CSS22.14kB (gzip5.31kB); these are build measurements, not startup latency or a complete baseline comparison.

The operator create-ticket dialog also consumes `TocynDialog`. Its draft/retry, pending-submit dismissal lock, initial focus and focus-return tests pass (73 dashboard tests); dashboard build passes. Navigation and remaining settings modal/menu migrations are still pending.

Mobile navigation migration: shared Arkdialog now owns opening, Escape and focus restoration. Actual route selection restores Workspace focus; cancellation returns to the opener. Custom content IDs are registered with the Arkroot. Five layout regressions and full76dashboard/59portal/6shared tests pass; actual browser focus containment and edge layout remain to verify.

User-details/filter-editor migration: shared modal naming, initial focus and opener restoration are covered by six new tests. Filter save pending/error/retry behavior retains entered values and blocks duplicate/dismissal races. Conditions have accessible field/operator/value/remove names. User activity has no loaded records; hard-coded demonstration events were removed rather than presented as real activity. Actual activity-history/profile editing/invitations are not supplied by this UI migration. Dashboard82tests/build pass; browser acceptance remains pending.

Ticket-field editor migration: generated/manual keys, select options and Active payload are preserved. Shared dialog owns initial focus and return to either trigger; pending saves block duplicate submission/dismissal, and failure retains the draft with an alert/retry. Four regressions and dashboard86tests/build pass. Safari verified initial focus and empty-state trigger return. VoiceOver announced the labelled required field/form, but navigation automation failed; full assistive-technology acceptance remains open.
