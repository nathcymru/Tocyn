# Truthful queue page recovery — 13 September 2026

Owning issue #130 requires truthful queue-clear states. On merged `226ad24d`,
view switching retained the previous view's page anchor. Leaving page three of
All for a Mine queue containing one conversation therefore requested page three
and displayed a false empty-queue message. Population shrink could produce the
same result, with no pagination control when only one page remained.

The correction queries page one when the route actually changes to another view,
then updates the existing workspace preference controller. It does not mutate the
active anchor before navigation guards have accepted a transition. Initial saved
view restoration and same-view conversation selection/Back keep their page,
query and sort.

An authoritative empty response for the current page, beyond page one and with
positive total, starts recovery to page one. Placeholder/prior-query responses
cannot trigger recovery. The visible status explains the recovery while fetching.
Both list and table suppress queue-clear claims during recovery. Positive-total
empty responses are described as an empty page rather than an empty queue.

Validation: sixteen focused PersistentInbox tests passed, including All page
three to Mine page one and population shrink in both list/table presentations.
A final focused variant also released a delayed former-All response after Mine
loaded; it did not change the current page/view or claim recovery from that old
response. Dashboard TypeScript and diff checks passed. The existing twenty-ticket
custom-view restoration and failed-draft-flush regressions remain passing.

This is JSDOM/synthetic HTTP evidence, not actual browser scrolling or spoken
screen-reader acceptance. No server, retention, selection or query contract is
changed; #130 and Beta.2 acceptance remain partial.
