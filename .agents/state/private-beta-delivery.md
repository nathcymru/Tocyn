# Private-beta delivery coordination

Updated: 8 September 2026. This is the owner-requested recoverable execution snapshot.
GitHub issues, PRs and Project 4 remain authoritative for acceptance and scheduling.
No credentials, customer data, private findings or hidden reasoning belong here.

## Authority and accepted baseline

The current owner instruction authorises accelerated issue-driven implementation,
useful agent concurrency and persistent state. It does not authorise production,
paid resources, live customer providers, public releases or traffic cutover.
Current issue scopes supersede preserved historical scope; accepted ADRs and the
approved architectural roadmap define the two-tenant API/portal private beta.

Current accepted `main`: `3fae282897b5059ff4d6b3c16e4c9b867c8fbcd0` (PR #101).
Earlier integrated foundations include #43 tenant isolation, #46 security/dependency
remediation and #47 source-security acceptance. Those do not confer runtime clearance.

The owner explicitly authorised the existing PR-only review exception for #101.
All six mandatory checks passed first; the squash merge has a verified signature.
No CI/security/signature/main-integrity bypass was used.

## Completed delivery

[#20](https://github.com/nathcymru/Tocyn/issues/20) is complete through
[PR #101](https://github.com/nathcymru/Tocyn/pull/101). Supported Node 22.19/npm 10.9.3
install, 23 local migrations, local API and frontend serving, builds/lint/typecheck,
unit tests, synthetic D1 checks and local resource/recovery evidence were verified.
Independent review and the automatic review finding were resolved. The migration
creation command was tested in a temporary directory without database application.

[Completion receipt](https://github.com/nathcymru/Tocyn/issues/20#issuecomment-5590997788).
Project: Done, 100%, Actual start/completion 2026-09-08. Baseline start/target preserved
at 2026-09-08 / 2026-09-10; actual variance -2 Monday–Saturday working days.
See `docs/maintenance/contributor-setup-verification.md` for acceptance limitations.
Reusable interactive two-tenant provisioning remains #58, not part of #20 completion.
The post-merge main CI run 34271638658 also succeeded at the accepted merge revision.

## Readiness and dependency plan

Not ready. Eleven approved beta blockers remain open. The integrated prerequisite
#20 is complete; all later acceptance gates remain required.

| Issue | Required predecessors | Outcome / integration gate |
| --- | --- | --- |
| #57 | #20 complete | Isolated deployment, trusted workflow, controlled auth mail, rollback evidence |
| #58 | #57 | Repeatable two-tenant provisioning and scoped credentials |
| #19 | #58 | Per-surface tenant acceptance including negative/failure/revocation cases |
| #59 | #19 | Canonical API/portal conversation contracts |
| #60 | #59 | Validated, retry-safe mutations |
| #63 | #59 | Attributable audit events; integrate after #60 |
| #93 | #57, #60 | Authoritative narrow beta resource/admission controls |
| #61 | #60, #63 | Portal conversation end-to-end acceptance |
| #62 | #60, #63 | Human handling and response retrieval |
| #21 | #61, #62 | Automated plus keyboard/screen-reader accessibility acceptance |
| #65 | #57, #58, #19, #60, #61, #62, #63, #21, #93 | Final two-tenant AI-unavailable rehearsal and candidate evidence |

Critical remaining prefix: #57 -> #58 -> #19 -> #59 -> #60.
#63 may develop after #59 but integrates after #60. Then #61/#62/#93 may run
concurrently in independent areas. #21 follows both frontend outcomes. #65 joins all
required gates. Preparatory analysis may run ahead without claiming completion.

Full cost governance #50/#64/#90, durable ingestion #91, UI redesign #48/#66,
production readiness #42, native mail #18, provider channels, autonomous resolution
and privacy metadata are not first-beta blockers. Any additional work necessary for
a beta issue's correctness remains required and tracked; exclusions cannot hide defects.

## Active allocation and ownership

| Task | Agent / environment | Model / effort | Reason / state |
| --- | --- | --- | --- |
| Coordination, acceptance, integration | Root / local | Inherited session | Cross-cutting authority; coordinator accepts issue completion |
| #57 source implementation | beta_environment_impl / isolated checkout | gpt-5.6-terra / high | Credential, trust, environment and recovery boundaries; source checkpoint validated |
| #57 release packaging escalation | release_packaging_escalation / Codex | gpt-6-astra / high | Escalated artifact integrity/provenance corrections passed focused tests |
| #57 independent security review | tenant_acceptance_prep / Codex | gpt-5.6-terra / high | Bounded deployment trust review passed |
| #58 preparation; #57 demonstration documentation | dependency_audit / Codex | gpt-5.6-terra / medium | #58/matrix preparation and canonical documentation complete |
| #20 setup implementation | setup_plan / Codex | gpt-5.6-terra / medium | Complete and integrated |
| Work acceptance-review attempt | Existing ChatGPT Work task | Existing configuration | Connector load timeout; execution unconfirmed |

Active branch: `codex/57-isolated-beta-environments`, based on merged #101.
Implementation owner controls deployment scripts/config/workflow and application code.
The packaging escalation agent exclusively owns `scripts/deployment/isolated-release.mjs`,
`isolated-release.test.mjs` and `verify-release-artifact.mjs`; the issue owner yielded these.
Documentation preparation is complete in `docs/isolated-environments.md` and `docs/README.md`. Root alone owns this state file and GitHub governance.
The independent security reviewer remains read-only, avoiding overlapping edits. One coherent #57 source-preparation PR is the next publication boundary. Resolve its
current URL/checks from branch `codex/57-isolated-beta-environments`; this snapshot
is recorded before publication to avoid repeated review-triggering metadata pushes.

Four concurrent Codex slots are exposed including root. No greater concurrency is
claimed. Work's connector timed out; Computer Use then explicitly denied access to
the app. Do not bypass that restriction or claim use of its separate allowance.
The owner offered to approve Mac access; no Mac prompt had been raised. A subsequent
retry of the supported Work connector also returned a conversation-load timeout.

## Next-dependency findings

#58 preparation requires A/B customer and A/B operator principals. Existing canonical
email uniqueness is global; demonstrate duplicate-canonical-email rejection and do not
claim same-email membership across tenants. Scoped local IDs may collide in tests.
Operators must authenticate through the real MFA challenge/verification path before
using protected management endpoints; customer-only fixtures are insufficient for the
approved human-led beta. A fixture may bootstrap generated, encrypted MFA material,
but that does not prove interactive operator self-enrollment. #58/#62 must track any
necessary gap without disabling MFA or silently excluding operators from the beta.

## #57 execution and final external-operation gates

Project #57: In progress, Actual/Forecast start 2026-09-08 following early prerequisite
integration. Baseline start/target remain 2026-09-11 / 2026-09-22. Forecast target and
successor dates stay unchanged while external-operation evidence remains uncertain.
Progress stays at its prior value until acceptance evidence supports an update.

Read-only resource inventory found no approved existing Tocyn environment. Prepare
disjoint `tocyn-preview` and `tocyn-beta` stacks; never reuse unrelated resources or
copy a broad local OAuth credential into CI. Explicit resource/secret manifests,
trusted immutable revisions, protected deployment jobs, fail-closed environment
validation, reproducible artifacts and rollback preparation are authorised source work.

Actual resource provisioning/selection, restricted ingress, least-privilege credentials,
exact trusted origins, test-mail sender/recipient allowlist and isolated data restore
must be concrete and owner-approved before external execution. Default deployments
must not expose test APIs before the approved access boundary exists. #93 runtime
admission/invitation controls remain distinct from deployment-workflow protection.
No deployment or mail demonstration exists yet; source preparation alone cannot close #57.

## Validation and review gates

Mandatory checks: Tocyn / lint, typecheck, build, test; Analyze (javascript-typescript)
and Analyze (actions). Strict current-base checks and verified main commits apply.
Do focused tests first, internal review and acceptance checks before a meaningful PR,
then all required checks on the final head. Existing GitHub rules automatically review
drafts and pushes with Copilot; consolidate corrections and avoid manual rerequests.

GitHub open CodeQL, Dependabot and secret-scanning alert counts were zero at baseline
reconstruction. This is a dated observation, not a security certification. #19's private
preparation must be reconciled with final fixtures/runtime evidence; disabled surfaces
remain explicitly unsupported and private pre-activation findings stay private.

## Current #57 local validation checkpoint

Application owner reports passing server 329, portal 12 and widget 3 tests; server
typecheck/lint, portal lint, local D1 smoke/integration and all three frontend builds.
Independent bounded review passed provider-resource/Access preflight, default and
wildcard Pages coverage, actual discovered-alias ingress probes and known-good rollback.
These are local synthetic checks only. Escalated packaging verification now passes
19 deployment tests, including artifact tamper, clean-source, path escape and fixture
reproducibility checks. Actual application builds at source checkpoint `523add383d89861b89f5e550f7df439170454bd2`
from two clean checkout locations produced byte-identical 36-file artifacts (2,217,507
bytes), verified by portable Wrangler dry runs. Release digest:
`50b28abe64fcde5f17018608288103d80643e28cfa78d8127a28deb188582000`.
See `docs/isolated-environments.md` for exact local evidence and unrun remote gates.
PR publication/required CI and actual environment acceptance remain pending.

## Exact next actions

1. Source implementation, independent review and local validation are complete.
2. Publish the consolidated branch and check all mandatory CI/security results.
3. Maintain a coherent #57 PR with Progresses #57 while deployed/mail/rollback evidence is
   outstanding. Present concrete external-operation authority choices after preparation.
4. After #57 accepted integration and real demonstration, implement #58, then #19.
5. Update issue/Project and this snapshot on meaningful delivery, merge, blocker or handoff.
   Preserve baseline dates; derive progress and reforecasting from acceptance evidence.
6. Give operational updates in the coordinating task at least every 30 minutes.
