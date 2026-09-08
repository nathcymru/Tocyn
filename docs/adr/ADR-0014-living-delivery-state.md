# ADR-0014 — Living delivery state uses baseline, forecast and actual evidence

- **Status:** Accepted
- **Date:** 8 September 2026

## Context

Tocyn's roadmap is implemented largely through coding-agent work. Without a persistent completion protocol, partial work can disappear into branches and project dates can be repeatedly overwritten until the roadmap no longer shows whether delivery is ahead or behind the approved plan.

## Decision

Every substantive implementation is issue-owned and delivered through a pull request. Complete delivery uses `Closes #NN`; coherent partial delivery uses `Progresses #NN` and keeps the issue open.

Project scheduling uses distinct fields:

- **Baseline start / baseline target** — immutable owner-approved plan;
- **Forecast start / forecast target** — current expected dates and may move with evidence;
- **Actual start / actual completion** — observed dates;
- **Progress %** — evidence-based progress, with 100% only after integrated acceptance;
- **Schedule variance** — actual/forecast comparison to baseline.

Each meaningful partial or complete delivery leaves an issue/PR completion receipt covering evidence, remaining acceptance, progress and schedule impact.

## Consequences

- Reforecasting does not erase the original plan.
- Partial work remains reconstructable between agent sessions.
- Project views can show ahead/behind status and critical-path effects.
- Merge is not automatically equivalent to issue completion.
- Automated review is requested at meaningful PR boundaries rather than continuously.

## Related

- `AGENTS.md`
- `.agents/workflows/issue-delivery.md`
- `.agents/workflows/pull-request-completion.md`
- `.agents/workflows/roadmap-reforecast.md`
