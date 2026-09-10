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

Group-members migration: shared modal focus/dismissal and return, visible named removal actions, explicit member-removal confirmation, guarded mutation/dismissal, inline retry/error and status announcements. Existing admin visibility and group/user mutation payloads retained. Four focused regressions cover focus, duplicate/error/retry, confirmation/cancellation, non-admin visibility and unavailable membership data; dashboard90tests/build pass. Browser/screen-reader and remaining group-create/delete flows are still to validate/migrate.

Administration dialogs: group create/delete and knowledge category/article delete now consume shared dialogs with safe initial focus, actual opener return on cancellation and stable heading focus after deletion. Mutations block duplicate/pending dismissal; failures retain the target/draft and show retry feedback. Group cancellation preserves its existing draft behavior. Knowledge category actions are always visible/named; selection exposes pressed-state buttons. Seven additional regressions and full dashboard97tests/build pass. Real browser/assistive technology and remaining native confirmations/settings feedback/menus still require acceptance.

Shared confirmation composition is exported with named extendable `TocynConfirmDialogProps` from `@luminatick/ui/dialog`. Caller owns `open`, `onOpenChange`, `busy`, `onConfirm`, error/recovery and final focus; the component owns named/described modal semantics and Cancel initial focus. Both shared dialog wrappers forward the content ref and preserve caller ARIA descriptions. Static confirmation styles use existing surface/text tokens; interaction tests run without presentation CSS. Filter/automation deletion now uses this composition. Final dashboard101/portal59/widget3/shared7tests, UI typecheck and all3client builds pass. Remaining browser/assistive-technology/performance acceptance is not implied by these regressions.

API-key controls now use shared create/revoke dialogs, labelled required name entry, guarded mutation/dismissal and stable focus. Uncertain creation results remain explicit; metadata refresh failures are visible, acknowledged revocations are not resurrected by late list responses, and matching one-time displays are cleared. Copy feedback waits for clipboard resolution and supports failure/retry without logging key material. Seven regressions and full dashboard108tests/build pass. Server access enforcement remains unchanged; full browser/assistive-technology acceptance is separate.

Channel controls: widget save/copy now exposes accurate status/error feedback, guarded pending operations, retained failed/unsaved choices and load-failure protection. Checkbox help associations/label sizing are explicit. Email removal consumes the shared confirmation with target-preserving retry and focus behavior. Six additional regressions and dashboard114tests/build pass. The embed snippet is an integration example with required public-key/API-build/sign-in setup; it no longer uses the ignored global configuration or asserts complete styling isolation. #67 still owns the full wrapper/embedding contract and evidence.

Widget ticket-form increment: explicitly associated labels, read-only authenticated email, duplicate-submit guard, pending announcement/disabled editing, retained failed content with focused alert, and success/new-draft focus. The existing request URL, authenticated headers, credentials omission and body contract are unchanged. Two regressions bring widget coverage to 5 tests/2 files; widget build and new strict typecheck pass. Shared UI typecheck and workflow validator pass. Existing CI now includes widget and shared-UI typechecks without removing other checks. Dashboard114/portal59/shared7 results are prior unchanged-subsystem evidence, not reruns. Browser/assistive-technology, remaining controls and performance acceptance remain open; no #48 completion or forecast change.

Widget shell/chat increment: Ark Tabs is exported through the shared headless entrypoint and consumed with manual keyboard activation (arrows/Home/End move focus; Enter/Space selects). Named launcher/close controls expose expanded state; Escape restores the launcher. Hidden mounted panels preserve local drafts across tab/close/reopen; disappearing sessions unmount private content, and changed login email keys fresh content. Ticket-only configuration selects the enabled feature. AI chat has a named input/send action, conversation log/pending announcement, synchronous duplicate guard, retained failed question with focus and explicit retry, malformed-response handling and no fabricated assistant error message/raw logging. Scrolling is non-smooth and loading dots no longer bounce. Request credentials/history contracts remain unchanged; these mock tests are not backend authorization proof.

Validation: widget11/dashboard114/portal59/shared7 tests pass; widget/shared typechecks and all three client builds pass. Added six widget regressions cover keyboard/disclosure/draft continuity, AI-off mode, session disappearance, pending/history and HTTP/malformed-response recovery. Actual browser/shadow-root navigation remains a required check, not inferred from JSDOM; #67 still owns environment/embedding isolation. Ark automatic-selection timing did not pass the initial DOM test; final manual-activation semantics are explicit and tested, with actual-browser acceptance outstanding. Existing Vite/bundle warnings remain; measured full performance budgets and remaining retained controls remain open.

Layout disclosure increment: account and connection details now consume shared Ark Popover rather than document-level outside-click/Escape implementations. Named content, first-action focus, dismissal/trigger return and reconnect behavior are covered. Account navigation has an explicit Workspace final-focus target, fixing a rapid-navigation focus race; duplicate sign-out requests are guarded while failed server sign-out still clears local authentication and shows the existing warning. Seven layout regressions and full dashboard116tests/21files plus TypeScript/build pass. JSDOM supplies ResizeObserver/geometry; real-browser positioning, nested mobile navigation and assistive-technology acceptance remain required. Existing bundle warning remains. No authentication API/authority or realtime semantics changed; other clients/shared source unchanged in this increment.

Ticket-detail retained-control increment: QA actions are always visible, named pressed-state buttons with minimum-height targets and explicit light/dark button contrast on a white action surface. A synchronous pending guard prevents overlapping QA writes; fixed error/status feedback replaces raw-error alerts. Existing viewer names, including overflow beyond three avatars, are exposed as text to assistive technology; decorative avatars are hidden from its tree and the pulse is removed. QA marked replaces INDEXED because the service updates QA state before vector upsert, so a flag alone does not prove indexing.

Full dashboard118tests/21files and TypeScript/build pass; two new regressions cover pending/failure/retry/pressed state and filtered full viewer names. Browser/computed contrast/target-size acceptance remains open. Backend QA contract discrepancy discovered: current UI sends question/answer/null, while TenantKnowledgeService.markArticleAsQA declares answer/sop/null and the handler accepts unvalidated JSON. This predates the increment; backend QA validation/contract acceptance is unresolved, recorded here and in48receipt, and must be assigned through existing knowledge/QA scope before claiming that integration. No backend changes, real AI calls, provider activation, or full48completion.

Safari18:41BST10September: desktop popover/destination focus and390×844mobile focus wrap/nested Escape verified on synthetic5190/8899. Screenshot exposed account-content clipping; fixed positioning corrected it and was rechecked visually. Dashboard119tests/build pass. Evidence: docs/security/evidence/ui-48-safari-popovers-2026-09-10.md includes tested source blob/limits. Responsive mode restored. Disconnected realtime, full spoken VoiceOver and remaining performance/cross-browser acceptance stay explicit.
