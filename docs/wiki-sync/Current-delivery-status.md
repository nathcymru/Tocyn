# Current delivery status

Last verified: **22 September 2026**.

This page separates code integrated on `main` from work that exists only in an
issue, pull request or branch. GitHub issues and pull requests remain the live
operational record; the approved roadmap and its historical baselines remain
unchanged.

## Published release and integrated revision

| Record | Current state |
| --- | --- |
| Published release | [`v0.4.0-beta.1`](https://github.com/nathcymru/Tocyn/releases/tag/v0.4.0-beta.1) is the only GitHub release. It was accepted with synthetic local data and local mail capture; it was not a hosted deployment. |
| Accepted Beta.1 application revision | `049ea82a02571681f834bcd87d43253603edf71f` |
| Current application integration checkpoint | `36a18fc75df9e77a16be18ed366af17501c14c82`, merged by [PR #313](https://github.com/nathcymru/Tocyn/pull/313) on 22 September 2026. The later governance-only documentation and dependency checkpoint does not replace this application evidence. |
| Beta.2 | **Not accepted or released.** [Issue #140](https://github.com/nathcymru/Tocyn/issues/140) remains open. |
| Hosted/production service | None operated by the Tocyn project. Production cutover and rollback remain governed by [issue #42](https://github.com/nathcymru/Tocyn/issues/42). |

`main` contains the Beta.1 foundation plus later integrated work. Closed acceptance
issues include shared headless primitives and tenant theme tokens
([#48](https://github.com/nathcymru/Tocyn/issues/48),
[#66](https://github.com/nathcymru/Tocyn/issues/66)), the conversation composer
([#68](https://github.com/nathcymru/Tocyn/issues/68)), granular capabilities
([#79](https://github.com/nathcymru/Tocyn/issues/79)), SLA progress and responsible
handlers ([#73](https://github.com/nathcymru/Tocyn/issues/73)), durable operator
continuity ([#129](https://github.com/nathcymru/Tocyn/issues/129)) and explicit
waiting reasons ([#136](https://github.com/nathcymru/Tocyn/issues/136)). Main also
contains reviewed partial increments for resource admission and recovery, the
operator workspace, queues, activity, assignment/capacity controls, knowledge and
search. Their open owning issues still govern the remaining acceptance work.

[PR #316](https://github.com/nathcymru/Tocyn/pull/316) integrated the official
Park UI source foundation on Ark UI and Panda CSS, the Phosphor icon boundary,
Tiptap migration and active legacy-component removal. Subsequent integrations
preserved that foundation: [PR #318](https://github.com/nathcymru/Tocyn/pull/318)
added the classified priority matrix and live 20-ticket fixture,
[PR #320](https://github.com/nathcymru/Tocyn/pull/320) completed the approved Inbox
motion behavior, [PR #319](https://github.com/nathcymru/Tocyn/pull/319) added the
unattended snooze-resurface runtime path, and
[PR #313](https://github.com/nathcymru/Tocyn/pull/313) added persisted operator
Table-column preferences. These are partial implementations of their open owning
issues and do not establish Beta.2 acceptance.

## Open acceptance work

The principal open Beta.2 work includes:

- task queues and snooze/resurface under [#130](https://github.com/nathcymru/Tocyn/issues/130);
- workload-aware queues and capacity controls under [#137](https://github.com/nathcymru/Tocyn/issues/137);
- complete Park/Panda product integration under [#315](https://github.com/nathcymru/Tocyn/issues/315);
- contract/criticality classification and time-first Inbox views under [#317](https://github.com/nathcymru/Tocyn/issues/317); and
- the final operator-workspace usability, accessibility and release decision under [#140](https://github.com/nathcymru/Tocyn/issues/140).

Other open workspace issues retain their own acceptance criteria. A merged partial
increment does not close an issue or satisfy a release gate by itself. Specialist
browser, visual, accessibility, migration, runtime and release checks are run when
their substantive milestone is ready; routine pull-request CI remains limited to
the ordinary merge gates.

## Branch and pull-request snapshot

The 22 September consolidation merged [#313](https://github.com/nathcymru/Tocyn/pull/313),
[#316](https://github.com/nathcymru/Tocyn/pull/316),
[#318](https://github.com/nathcymru/Tocyn/pull/318),
[#319](https://github.com/nathcymru/Tocyn/pull/319) and
[#320](https://github.com/nathcymru/Tocyn/pull/320). It closed the stale or deferred
[#261](https://github.com/nathcymru/Tocyn/pull/261),
[#293](https://github.com/nathcymru/Tocyn/pull/293) and dependency-update pull
requests [#295](https://github.com/nathcymru/Tocyn/pull/295) through
[#302](https://github.com/nathcymru/Tocyn/pull/302) without merging them. Their
relevant issue receipts record retained work and deferrals. No feature pull request
remained open before this governance checkpoint. The unrelated #243 local branch
and its uncommitted work remain preserved for its owning issue.

## Source hierarchy

- Current implementation: the exact revision on `main` and its code/configuration.
- Acceptance state: current issue criteria, merge receipts and Project fields.
- Approved target and schedule: [[Post-beta-master-baseline]] and [[Approved-architectural-roadmap]].
- Releases: signed/tagged GitHub release records.
- Deployment: separately verified environment evidence; source support alone is not deployment.
