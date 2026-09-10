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

Non-goals for this slice: full dashboard/portal/widget adoption, workspace routing, durable drafts, snooze/waiting state, permissions, tenant policy, theme persistence and wrapper packaging.
