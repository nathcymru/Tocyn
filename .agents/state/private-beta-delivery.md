# Private-beta delivery coordination

Updated: 8 September 2026. Coordinator: current accelerated-delivery owner instruction.
This is a recoverable execution snapshot; GitHub issues, PRs and Project remain the
authoritative acceptance and schedule records. No issue is complete from this file alone.

## Verified baseline and authority

- Clean local `main` and fetched `origin/main`: `2eedcab2458685612d7c4e92c9d69234cc99e844`.
- Latest baseline CI succeeded (run 34265759898); no open PRs at reconstruction.
- Recent integrated foundations: #43 tenant isolation, #46 security/dependency remediation,
  #47 source-security acceptance; #95/#97/#98/#100 governance/docs/community changes.
- Current approved issue scope supersedes preserved historical scope. ADR-0011 through
  ADR-0015 and the approved architectural roadmap define API/portal-first beta boundaries.
- The current owner instruction authorises implementation and greater useful concurrency;
  it does not erase baseline dates or authorise production, paid resources, live customer
  providers, public release, or production traffic cutover.
- GitHub Project 4: baseline dates unchanged. #20 set In progress, Actual start 2026-09-08;
  existing Progress % retained at 0 pending accepted evidence.

## Readiness and dependency plan

Not ready. All twelve approved beta blockers remain open:

| Issue | Required predecessors | Integration gate / outcome |
| --- | --- | --- |
| #20 | Existing baseline | Reproducible local setup, migrations, synthetic checks, all app commands |
| #57 | #20 | Isolated deployment, trusted workflow, controlled auth mail, rollback evidence |
| #58 | #57 | Repeatable two-tenant provisioning and scoped credentials |
| #19 | #58 | Complete per-surface tenant acceptance, including failure/revocation cases |
| #59 | #19 | Canonical API/portal conversation contracts |
| #60 | #59 | Validated, retry-safe mutations |
| #63 | #59 | Audit events; integrate after #60 (explicit integration constraint) |
| #93 | #57, #60 | Narrow authoritative beta admission/resource controls |
| #61 | #60, #63 | Portal conversation end-to-end acceptance |
| #62 | #60, #63 | Human operator handling and response retrieval |
| #21 | #61, #62 | Automated plus keyboard/screen-reader accessibility acceptance |
| #65 | #57, #58, #19, #60, #61, #62, #63, #21, #93 | Final two-tenant AI-unavailable rehearsal and candidate evidence |

Critical execution prefix: #20 -> #57 -> #58 -> #19 -> #59 -> #60.
After #59, #63 preparation/implementation may overlap #60 but cannot integrate first.
After #60/#63, independent #61/#62/#93 areas may proceed concurrently; #21 follows
both frontend outcomes. #65 joins every required gate. Preparation and targeted review
may run ahead without claiming dependencies are complete.

Full cost governance #50/#64/#90, durable ingestion #91, headless redesign #48/#66,
production readiness #42, native mail #18, provider channels, autonomous resolution and
privacy metadata are not first-beta blockers. Necessary correctness work discovered in
a beta issue remains required and must be tracked; these exclusions cannot hide defects.

## Allocation and integration ownership

| Task | Agent / environment | Model / effort | Reason / state |
| --- | --- | --- | --- |
| Coordination, acceptance, integration | Root / local | Inherited session configuration | Cross-cutting authority; coordinator alone accepts completion |
| Dependency audit; then #57 preparation | dependency_audit / Codex subagent | gpt-5.6-terra / medium | Bounded read-only evidence synthesis; dependency audit complete |
| #20 implementation and command verification | setup_plan / isolated local checkout | gpt-5.6-terra / medium | Established setup patterns with bounded config changes; active |
| #57/#65 independent acceptance review | Existing ChatGPT Work task | Existing task configuration, lowest sufficient requested | Dispatch returned conversation-load timeout; execution unconfirmed |

Active branch: `codex/20-contributor-setup`. Implementation owner edits setup/docs/config;
coordinator owns this state file. No overlapping file ownership. PR: [#101](https://github.com/nathcymru/Tocyn/pull/101). Supported-runtime validation,
independent review and all six required CI/CodeQL checks passed at `cea8f55`.
Normal merge was rejected by the approving-review rule; owner review-exception authority
is pending. This snapshot-only follow-up must also pass required checks before merge. Preserve one coherent issue PR and batch corrections.

The environment exposes four concurrent Codex agent slots including the coordinator.
Do not claim greater concurrency or successful use of a separate allowance without evidence.

## Validation and operational gates

- Required GitHub checks: Tocyn / lint, typecheck, build, test;
  Analyze (javascript-typescript), Analyze (actions). Strict current-base checks apply.
- Internal diff/acceptance review precedes near-final PR creation. Existing GitHub rules
  automatically request Copilot reviews for drafts and on push; avoid intermediate PR
  creation and repeated pushes. No additional manual Copilot requests planned.
- #20: supported Node 22.12+ below 23, locked install, local migrations, synthetic D1
  integration, all documented app starts/builds/checks, resource and recovery evidence.
- Initial coordinator install under machine-default Node 26 completed but produced an
  engine warning; it is not supported-runtime verification. Node 22.19 is available;
  issue owner must use it in the isolated checkout.
- No deployed beta or verified test-mail environment exists in the inspected evidence.
  #57 must prepare concrete manifests and destinations before seeking missing operational
  authority. Never reuse inherited identifiers as an approved target.
- Local/synthetic tests do not prove Cloudflare runtime, distributed, real email, browser,
  screen-reader, recovery or final integrated-revision acceptance.

## Exact next actions

1. #20 local changes and command evidence are complete; see
   `docs/maintenance/contributor-setup-verification.md`. Obsolete local seed scripts were
   removed after internal review. All documented checks passed on Node 22.19/npm 10.9.3.
   Independent dashboard/portal/widget HTTP probes passed. PR #101 is ready and awaits
   an approving review or explicit owner authority for the existing PR-only exception.
2. Internal review and corrections are complete. Verify all required checks on the final
   PR head and integrate only when the approving-review boundary is satisfied.
   Do not bypass CI, security or signature requirements.
3. Finish #57 manifest/workflow/owner-input preparation while #20 runs; begin dependency-
   cleared implementation after #20 acceptance. Do not deploy during preparation.
4. Update issue/Project and this snapshot on meaningful delivery, merge, blocker or handoff.
   Preserve baseline and use evidence for progress/forecast changes.
5. Report concise operational progress in the coordinating task at least every 30 minutes.

## Preparation receipts

- #57 resource inventory found no approved existing Tocyn target. Prepare disjoint preview
  and beta stacks; no unrelated resources may be reused. Separate isolated credentials,
  exact origins, controlled mail destinations and restore decisions are final operational
  gates; they do not prevent source preparation.
- #19 read-only surface audit is complete. It must reconcile existing Phase 1 tests against
  #58 fixtures and final runtime evidence. Disabled optional surfaces remain explicitly
  unsupported; private pre-activation findings must not be copied to public tracking.
- GitHub open CodeQL, Dependabot and secret-scanning alert counts were each zero during
  reconstruction. This is a dated baseline observation, not a security certification.
- Work acceptance-review dispatch returned a conversation-load timeout. No separate-pool
  execution is confirmed; local internal review completed the bounded review instead.

## Current integration blocker

GitHub rejected the normal squash merge of #101 after all required checks passed.
The owner has been asked to authorise the existing PR-only administrator review
exception for this PR or supply an approving review. No exception was used.
The [issue progress receipt](https://github.com/nathcymru/Tocyn/issues/20#issuecomment-5590889725)
records the exact validated revision and remaining gate. #20 remains open/In progress;
all twelve beta blockers remain open. No forecast or numerical progress was invented.
Dependency-cleared beta implementation cannot proceed past #20 until integration.
