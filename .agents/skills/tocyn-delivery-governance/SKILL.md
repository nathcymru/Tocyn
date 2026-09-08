---
name: tocyn-delivery-governance
description: Keep Tocyn issues, pull requests, Project progress and baseline/forecast/actual schedule state synchronized through partial and complete delivery.
---

1. Read the owning issue's current approved scope, acceptance criteria, milestone, dependencies, baseline effort and dates. Historical preserved text is evidence, not current scope where superseded.
2. Before coding, confirm no conflicting active PR. Work on a dedicated issue branch. Set/confirm Project status `In progress` and `Actual start` when Project write access exists.
3. Preserve baseline dates. Never move a baseline to hide lateness. Update only forecast dates when evidence changes the likely schedule.
4. Use one coherent PR per issue where practical. If stopping with useful partial work, push it to the existing branch and keep/open a draft PR with `Progresses #NN`, an explicit remaining-work list and validation evidence.
5. Before review, run the relevant deterministic checks. Consolidate fixes; avoid repeated automated review cycles for trivial intermediate edits.
6. After a meaningful partial merge, add an issue progress receipt containing: delivered outcome, PR/commit, checks, acceptance criteria advanced, remaining work, risks/blockers, defensible `Progress %`, and any forecast change with reason.
7. After complete delivery, prove every acceptance criterion against the integrated revision, set `Progress % = 100`, record `Actual completion`, set Project status `Done`, close the issue and update affected dependent forecasts.
8. Schedule variance is forecast/actual completion minus immutable baseline target in working days. Negative is ahead; positive is behind. Reforecast affected critical/near-critical successors when the movement is material.
9. If Project write access is unavailable, record the exact intended field changes in the issue/PR receipt and report the access limitation. Never claim synchronization that did not occur.
10. Do not equate lines changed, commits, elapsed time or checkbox count with completion. Weight progress by material remaining effort/risk and acceptance evidence.

Use `.agents/workflows/issue-delivery.md`, `pull-request-completion.md` and `roadmap-reforecast.md` for repeatable procedures.
