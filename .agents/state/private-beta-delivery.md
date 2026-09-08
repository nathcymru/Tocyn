# Private-beta delivery coordination

Updated: 8 September 2026. GitHub issues, accepted ADRs and Project 4 remain the
acceptance/schedule records. This snapshot preserves current decisions and next actions.

## Current owner authority

The owner directs accelerated issue-driven delivery with useful independent agents,
mandatory validation, maintained tenant/security boundaries and no artificial readiness.

The owner now explicitly selects **local Wrangler simulations only**, served at
`http://localhost:8787`, and local capture for `tocyn-auth-test@example.invalid`.
Do not connect to, deploy into or modify any existing Cloudflare account, zone, domain,
DNS, Worker, D1, KV, R2, Queue, Durable Object or email resource. Do not send mail via
Resend or another external provider. Authentication messages/links must be inspectable
locally. GitHub source governance remains authorised. Do not ask for remote account,
domain, credentials or mail-delivery authority for this local test phase.

The current owner instruction is recorded atop [#57](https://github.com/nathcymru/Tocyn/issues/57).
It supersedes the earlier remote environment/mail target for this phase, while all
other architecture, security, tenant, failure and validation gates remain. Cloud
configuration already merged is source preparation only; no cloud runtime clearance
or production authority is inferred from local testing.

Standing authority: the owner explicitly authorises the PR-only approving-review
exception for #102 and subsequent Tocyn delivery PRs **after internal review and all
required CI/security checks pass**. #101 had its own explicit approval. No exception
waives checks, signed commits or main integrity. Do not request this approval again.

## Integrated work and evidence

Current main: `f0bb45e2b72eb1c1e5ba9f75ccd40b486fd716e1` (verified PR #102 merge).
Earlier foundations #43/#46/#47 remain implemented, without production clearance.

[#20](https://github.com/nathcymru/Tocyn/issues/20) is complete through
[PR #101](https://github.com/nathcymru/Tocyn/pull/101), merge
`3fae282897b5059ff4d6b3c16e4c9b867c8fbcd0`. Supported Node 22.19/npm 10.9.3 install,
23 local migrations, API/frontend serving and required checks were verified.
[Completion receipt](https://github.com/nathcymru/Tocyn/issues/20#issuecomment-5590997788).
Project Done/100%, actual start/completion 2026-09-08; baseline preserved at
2026-09-08 / 2026-09-10, variance -2 Monday–Saturday working days.

[#57](https://github.com/nathcymru/Tocyn/issues/57) is **open**. Source preparation
merged through [PR #102](https://github.com/nathcymru/Tocyn/pull/102), including disjoint
manifests, isolated entrypoint, controlled mail transport, artifact/provider/Access
verification and rollback preparation. All required checks passed on final PR head
`94753201826e2e6b6578f8ddd8136862f778a751`; both automatic-review findings were fixed
in one batch with real Git CLI regressions. No manual Copilot re-review requested.
[Merge receipt](https://github.com/nathcymru/Tocyn/issues/57#issuecomment-5591721084).

Local evidence: server 329, portal 12 and widget 3 tests; 21 deployment tests; lint,
typecheck, D1 smoke/integration and three frontend builds passed. Two clean checkouts
at `523add383d89861b89f5e550f7df439170454bd2` produced byte-identical 36-file artifacts,
2,217,507 bytes, with actual portable Wrangler dry runs. Release digest:
`50b28abe64fcde5f17018608288103d80643e28cfa78d8127a28deb188582000`.
See `docs/isolated-environments.md` for evidence and limitations. No remote operation occurred.

## Immediate main-health repair

GitHub rejected the new manual workflow before any job on main:
[run 34277346687](https://github.com/nathcymru/Tocyn/actions/runs/34277346687).
`runner.temp` is unavailable in job-level environment expressions. PR CI/CodeQL had
passed but did not validate this semantic restriction. Do not claim healthy workflow
registration until the repair is integrated and main verified.

Repair branch `codex/57-workflow-context-fix` moves release-directory initialization
into runner steps and adds checksum-pinned actionlint 1.7.12 to the existing CI lint
gate. Local actionlint rejects the exact old workflow at both offending lines and
accepts all corrected workflows; five focused workflow tests and diff checks pass.
This is necessary #57 correctness work, not a change to readiness criteria.

## Active allocation and integration order

| Workstream | Agent/environment | Model/effort | Ownership/state |
| --- | --- | --- | --- |
| Coordination, main repair integration | Root/local | Inherited session | Issue/Project/state, workflow correction, acceptance |
| Semantic workflow validation | dependency_audit/local repair checkout | gpt-5.6-terra/medium | Helper and CI wiring complete; root review passed |
| #57 local runtime/mail capture | beta_environment_impl/local runtime checkout | gpt-5.6-terra/high | Active; auth/provider and exposure boundaries |
| Independent local runtime review | release_packaging_escalation/Codex | gpt-6-astra/high | Active read-only; explicit boundary/real auth proof |
| Prior provider/Access review | tenant_acceptance_prep/Codex | gpt-5.6-terra/high | Completed bounded source review |
| Work pool review attempt | Existing Work task | Existing configuration | Connector timed out; execution unconfirmed |

Local runtime branch: `codex/57-local-beta-runtime`, based on `f0bb45e`.
Integrate workflow repair first, refresh the local branch, then validate/integrate
local runtime. Root owns this state file. Runtime owner owns local entrypoint/config,
mail transport, focused tests and operator docs; no overlapping workflow edits.
Four concurrent Codex slots are available including root; no greater count is claimed.
Work connector retries timed out and Computer Use explicitly denied app access.
No macOS permission prompt was generated; owner consent cannot change that tool restriction.

Local capture contract: localhost:8787 and 127.0.0.1:8787 work while the server binds
loopback. Capture is injected by the dedicated local entrypoint, never enabled merely
by a production/isolated env string. No provider fallback on absent/failed capture.
Default recipient is the approved synthetic address. Bounded retention/count and
local inspection/reset must not expose mail in other runtimes or committed artifacts.
Complete the real request -> captured message/link -> verify -> replay-rejection path;
retain normal tenant resolution, credential hashing, rate limiting and JWT issuance.

## Critical path and readiness

Not ready. #20 is complete; eleven approved issue gates remain open. The owner's local
execution boundary changes the target environment, not the remaining dependency graph.

| Issue | Predecessors | Required outcome |
| --- | --- | --- |
| #57 | #20 complete | Explicit local simulations, captured real auth flow, isolation/resource/recovery evidence |
| #58 | #57 | Repeatable two-tenant provisioning and scoped credentials |
| #19 | #58 | Cross-surface tenant positive/negative/failure/revocation acceptance |
| #59 | #19 | Canonical API/portal conversation contracts |
| #60 | #59 | Validated retry-safe mutations |
| #63 | #59; integrate after #60 | Attributable audit events |
| #93 | #57, #60 | Narrow resource/admission controls |
| #61 | #60, #63 | Portal end-to-end acceptance |
| #62 | #60, #63 | Human handling and response retrieval |
| #21 | #61, #62 | Automated and manual accessibility acceptance |
| #65 | #57, #58, #19, #60, #61, #62, #63, #21, #93 | Final two-tenant AI-unavailable local rehearsal and candidate evidence |

#58 preparation is complete: A/B customers and MFA-protected operators, globally
unique canonical emails, scoped keys and isolated state. Customer-only fixtures are
insufficient. A generated encrypted fixture MFA secret does not prove self-enrollment;
track any necessary #58/#62 gap without disabling MFA. #57 uses minimal own synthetic
fixtures; never make #57 depend on #58. #19 private preparation remains outside public
repository records and must be reconciled with final fixtures/runtime evidence.

Non-beta roadmap items remain #50/#64/#90 full cost governance, #91 ingestion journal,
#48/#66 redesign, #42 production readiness, #18 native mail, further provider channels,
autonomous resolution and optional privacy metadata. Required correctness work cannot
be hidden inside these exclusions. No release/tag, customer onboarding or production work.

## Governance and exact next actions

#57 Project remains In progress, actual/forecast start 2026-09-08. Baseline stays
2026-09-11 / 2026-09-22; forecast target remains 2026-09-22 while local runtime evidence
is developed. Preserve prior numeric progress until acceptance evidence supports a
re-estimate; no actual completion or 100% claim. Reforecast dependencies only with evidence.

1. Publish/integrate the bounded workflow repair after required checks and standing
   review authority; verify main health and record receipt.
2. Complete #57 local capture/runtime implementation and independent review; run actual
   loopback Wrangler auth, isolation, reset/retention and resource/recovery evidence.
3. Update local operator docs and #57 acceptance mapping. Integrate via coherent PR,
   then accept #57 only when current owner-directed local criteria are evidenced.
4. Continue #58 -> #19 -> #59 -> #60; unlock independent #63/#93/#61/#62 as specified.
5. Preserve state/issue/Project truth after meaningful delivery, merge or blocker;
   conserve automatic reviews by batching corrections and avoiding manual rerequests.
6. Keep the owner informed at least every 30 minutes while actively delivering.
