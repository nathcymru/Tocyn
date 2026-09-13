# #128 persistent inbox transition evidence — 13 September 2026

Based on merged main `8b2e0687968e55c6379b557f978d9a7edad9f631`.
The existing `PersistentInbox.test.tsx` suite now includes two additional cases.
Its previous 20-result case selected only the first and final result; the new
case selects each of the 20 synthetic conversations sequentially.

The fixture begins in the existing custom Priority follow-up view, page3,
Oldest sort and the current-view query `follow up`. At every selection, the
route names the selected conversation and retains the same list and list-pane
DOM nodes, their assigned scrollTop, query and sort controls. Returning through
Back to conversations retains the custom route and list. Persisted workspace
writes retain custom filter, sort, query and page anchor; a list request carries
all four corresponding parameters.

The second case makes the actual DraftNavigationGuard's flush callback refuse
navigation. Back to conversations then retains the selected conversation,
custom list position and route, shows the guard error, and causes no preference
write. A subsequent acknowledged flush permits return while retaining the list,
query and sort. This verifies the guard's integration with workspace routing.

Validation: all10 PersistentInbox tests passed, including the two additions;
dashboard TypeScript and diff checks passed. No application implementation was
changed. The existing Vite future config-loader warning remains.

## Limits

This uses the actual InboxWorkspacePage, workspace preference hook, query client
and router with synthetic HTTP responses. TicketDetailPage is the existing test
double containing the real DraftNavigationGuard. It does not demonstrate a real
composer save, native D1 persistence, backend queue reclassification, actual
browser scrolling, responsive CSS or spoken screen-reader output. scrollTop is
an assigned JSDOM property whose retention verifies that the pane is not replaced;
it is not browser layout evidence.

#128 remains partial. Resolve/snooze and optional deterministic advance acceptance
still depends on #130; integrated mobile view/list/draft and assistive-technology
acceptance remain separate. This evidence does not declare Beta.2 ready.

The first CI run timed out only the20-transition case at the default5second
ceiling. Stable DOM references are now reused directly to assert their continued
attachment, avoiding repeated whole-page accessibility queries. That one bounded
20-step case has a15second ceiling; global test timeouts and checks are unchanged.

After refreshing onto main `b84453fe`, all10 focused tests passed. A full dashboard
run passed317/318, failing an unrelated existing activity keyboard test. One
focused rerun passed14/15 LayoutAccessibility cases with a different activity
heading-ambiguity failure. These failures are recorded rather than represented as
a full local pass; revised required CI remains the exact-head delivery gate.
