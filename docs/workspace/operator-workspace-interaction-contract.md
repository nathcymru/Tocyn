# Persistent operator workspace interaction contract

## 1. Purpose and boundaries

This contract defines the operator's persistent workspace for #127. It is sufficient for #128 and the shared primitives work in #48/#66 to implement and test the interaction model without prescribing decorative styling. It does not implement features, move primitives, change canonical tenant authority, or create a ticket data model.

The principal object is a conversation in a work view. Ticket metadata, collaboration, knowledge, AI assistance and technical diagnostics are context around that work. A ticket change changes the active conversation while preserving the selected work view and its resumable state.

## 2. Named surfaces and state

| Surface | Responsibility | Required state/behavior |
|---|---|---|
| Global application navigation | Dashboard, Inbox/workspace, Knowledge and settings destinations | Labelled, keyboard reachable, persistent expanded/collapsed preference; active destination is announced. |
| Work-view navigator | Mine, Unassigned, Mentions, Drafts, Snoozed, Needs Action, team/custom views | View identity, reason an item appears, bounded count/freshness, selected view. Counts never grant authority. |
| Conversation list | Scan and select conversations in the selected view | Stable order, selection, row attention reason, SLA/due signal when available, list anchor, loading/empty/error/retry state. |
| Active conversation | Read the thread and identify who/what/why/next | Stable header, message history, pagination/recovery, channel capabilities, customer-visible versus internal content. Switching selection does not remove the shell. |
| Compact work/action bar | State, ownership, priority, SLA and next action | One state-appropriate primary action; lifecycle, assignment and due information are grouped; destructive or rare actions are confirmed and attributable. |
| Composer | Public reply or internal note | Explicit mode, draft status, attachments, send acknowledgement/error/retry, optional governed AI/knowledge actions; no auto-send. |
| Context panel | Customer, ticket, collaboration, knowledge and operational detail | Collapsible, remembered per user, progressive disclosure; panel content is tenant/actor-authorized and not required to remember the primary task. |
| Activity centre | Durable operator notifications and attention events | Read state, source, affected conversation/view, timestamp and link; a toast may mirror an event but cannot be its only carrier. |
| Technical diagnostics | Degraded transport/admin support detail | Healthy connection is quiet in primary chrome; disconnected/degraded state has actionable recovery and remains discoverable. |

### State ownership

Canonical conversation state remains server-authoritative. Shared tenant/conversation work state is also server-authoritative and audited where it changes work: lifecycle, ownership, priority, SLA, snooze, next action and waiting reason. Per authenticated operator state is separate: draft revision/mode/attachments, selected view, list query/sort/anchor, panel preference, activity read state and presentation preferences. A shared snooze or waiting state is visible consistently to authorized operators; an operator's draft or read state is not silently presented as another operator's. Transient focus and pending request state may be local. Authority, tenant or session change clears or revalidates restored work state before display. Sensitive draft content uses authenticated scoped storage; long-lived browser storage is not canonical.

## 3. Responsive composition

| Width | Composition | Interaction contract |
|---|---|---|
| Desktop | Global nav + work-view navigator + conversation list + active conversation, with collapsible context panel | Selection updates the active conversation in place. List anchor and view remain visible. Context can be opened without leaving the conversation. |
| Medium | Global nav plus work-view/list region and active conversation; navigator or context may collapse into explicit controls | Collapsed regions have labelled triggers and restore their prior state. Selection does not navigate to a separate detail page. |
| Mobile/narrow | One primary pane at a time: navigator, list, conversation or context | Route and state identify the pane. Back returns conversation → list → navigator while preserving view query, selection, anchor, draft and panel preference. A deep-linked conversation returns to its authorized view/list when available. |

No width may hide a required error, safety status, public/internal mode, draft-loss warning or permission result. Pointer, keyboard and assistive technology reach every primary action; shortcuts only accelerate.

## 4. Routes, deep links and browser history

Canonical routes are:

```text
/inbox
/inbox/:viewId
/inbox/:viewId/:conversationId
```

Only opaque identifiers and an allowlist of nonsensitive presentation values may appear in URLs. Customer names, email addresses, message text, arbitrary/free-text search terms, draft bodies, credentials and tenant-sensitive payloads are prohibited in URLs. If a search term is needed, keep it in authenticated in-memory/server state or use a non-content query token whose server-side meaning is separately authorized. `/tickets` and `/tickets/:id` remain compatibility routes during migration and resolve into the workspace with the best authorized view context.

Deep-link behavior:

1. Authenticate and authorize the requested view and conversation.
2. Select the view, restore its safe query/sort and list anchor, then select the conversation.
3. If the conversation is authorized but no longer belongs to the requested view, show the conversation with an explicit out-of-view notice and offer the applicable authorized views; never silently change the view.
4. If unauthorized or unavailable, show the existing safe error/retry state without leaking existence or customer data.

History behavior:

- The first deliberate conversation activation from a list adds one history entry containing the view and conversation identity. Subsequent deliberate selections in that same workspace replace the active-conversation URL/state, so Back returns to the list rather than stepping through every row. A deliberate deep link or explicit open in a new navigation context adds its own entry.
- Browser Back from a conversation returns to the exact list state; on mobile it returns to the previous pane with the same state. Forward returns to the last active conversation when that entry exists.
- Resolve/snooze-and-advance replaces the active selection while retaining the current workspace history entry; it does not make Back replay each automatic advance.
- Resolve/snooze-and-advance updates the list and moves to the configured next item, with a stable completion/status announcement and an undo/reopen path where supported.
- Reload restores the last authorized work view and presentation state, then rehydrates the selected conversation and draft by revision.

## 5. Continuity, drafts and failure states

Switching conversations MUST preserve the selected work view, query/filter, sort, list anchor, panel preference, composer mode, draft revision/body and attachments. Draft autosave and retention are delivered by #129/#68; this contract defines their integration point and does not claim implementation.

Every save/send mutation exposes `saving`, `saved at revision`, `failed`, `retrying`, `sent` or `discarded`. A failed save never displays “Saved”; retry is idempotent and preserves the editable draft. Concurrent revision mismatch opens a review/merge decision without auto-resend or silent overwrite. On successful send, the sent content is shown in the conversation, the draft is cleared only after confirmation, and focus returns to the composer or the documented next action.

Existing beta recovery behavior is a release gate: failed reply/read/write paths keep user input and attachments, retain visible last-known content when refresh fails, place focus on the retry/error control, and never cross tenant or actor authority boundaries.

## 6. Search and filtering

There are two explicit concepts:

- **Search everywhere** (global command/search, `Ctrl/Cmd+K` and a discoverable labelled control): searches authorized conversations, customers, knowledge and navigation targets; results identify type and destination. It may open a result as a deep link while preserving the originating work view in history.
- **Filter this view** (inside the work-view/list surface): narrows only the selected view using documented fields and keeps view identity, query and pagination/anchor in state. It is never labelled “Search all tickets.”

Empty, loading, partial-result, unauthorized and network-failure states say which scope applies and provide retry/clear actions. Clearing the filter restores the selected view. Search results are bounded and tenant/actor-authorized. Search text and customer/free-text terms are never exposed in URL query parameters; only allowlisted nonsensitive filters and opaque identifiers may be URL state.

## 7. Salience, attention and progressive disclosure

The salience order is: current conversation and next action; genuine error, permission or SLA breach; selected view/selection; ordinary lifecycle/ownership state; optional context and technical diagnostics. Healthy realtime/operational state is visually quiet and not a primary attention target.

Routine realtime events go to Activity with a badge/read state. Only configured high-value classes may interrupt, and every actionable event remains durable. Motion honors `prefers-reduced-motion` and the user setting. Focus mode collapses optional context and suppresses noncritical activity without hiding safety, delivery, permission or failure state. Colour is never the only state signal. Hover is never the only path to a critical action.

The active conversation shows requester, concise subject/summary, reason it needs attention and next due/action. Assignment, priority, lifecycle, SLA and waiting reason are grouped. Customer, QA, presence, knowledge, AI and technical details open in named context regions; the reading flow has one presence region and no duplicate attention card.

## 8. Keyboard and focus destinations

The workspace exposes landmarks in this order: `Application navigation`, `Work views`, `Conversations`, `Active conversation`, `Work actions`, `Composer`, `Context`, `Activity`. On entry, focus moves to the page heading or the deep-linked conversation heading; after a list selection it moves to the active conversation heading; after opening a panel it moves to the panel heading; after closing it returns to its trigger.

Required keyboard destinations include: open/close navigation; move between work views; focus filter; move through conversations; activate a conversation; focus conversation heading; next/previous conversation; open work actions; choose public reply/internal note; focus composer; attach files; send; open/close context and activity; retry failures; and return to the prior pane. The conversation list uses roving focus: arrow keys move the focused row without activating it, while Enter/Space or an explicit activation command selects it and moves focus to the active conversation heading. A visible shortcut/help surface is provided by #71, and all actions retain pointer/AT paths.

Loading preserves the prior focus context where safe. Asynchronous errors are announced in the relevant live region and do not steal focus; focus moves only when the operator initiated an operation whose documented recovery destination is the error/retry control, and remains where it was for background refresh failures. Mutation completion returns focus to the stable next action and announces the result. Focus indicators meet the approved WCAG/target-size contract; preferences do not weaken contrast, focus or target protections.

## 9. Acceptance map and dependencies

| #127 acceptance | Evidence in this contract | Implementing/integrating owner |
|---|---|---|
| Every Critical LAW/COMP/COG mapped | [critical finding map](critical-finding-map.md) names each finding and surface/state | #127 contract; #128/#132/#133/#140 evidence |
| No conceptual loss on ticket switching | Sections 2, 4 and 5 state view/list/anchor/draft continuity | #128, #129, #71 |
| Table explicitly secondary | Inventory and section 2 make Conversation list primary and Table optional | #128, #135 |
| Healthy infrastructure absent from primary attention | Sections 2 and 7 move healthy transport to diagnostics | #133, #159 |
| ADR decisions reviewable | This contract links ADR-0017/18/19/20 and preserves their boundaries | #127, #128, #132/#133 |
| Responsive and keyboard focus specified | Sections 3 and 8 provide composition, back and focus destinations | #128, #71, #140 |

Authoritative prerequisite for #127 is #62. The other issue links above are integration dependencies and must not turn #127 into a feature implementation or force the whole downstream UX programme into one gate. Beta.2 still requires the owner's full SLA clocks/calendars/pause/resume/waiting treatment and responsible-handler routing across #73/#137 before release acceptance.
