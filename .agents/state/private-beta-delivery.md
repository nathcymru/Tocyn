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

Current main: `913b0c8e0c0b9bada3b8abb8aada7a98ac13e323` (verified PR #103 merge).
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

## Main health and local runtime evidence

[PR #103](https://github.com/nathcymru/Tocyn/pull/103) repaired the invalid job-level
`runner.temp` expression and added checksum-pinned actionlint 1.7.12 to required CI.
The old workflow fails both semantic checks; corrected workflows pass. Required PR
checks and main CI/CodeQL passed. The manual release workflow is now registered;
no workflow dispatch or remote operation occurred.
[Receipt](https://github.com/nathcymru/Tocyn/issues/57#issuecomment-5591843731).

Local runtime branch `codex/57-local-beta-runtime` is based on current main above.
The dedicated local entrypoint provides bounded in-memory mail capture, fails closed
on provider fallback, and binds loopback. Stale local Turnstile configuration cannot
call Cloudflare. Portal/dashboard use fixed loopback ports 5174/5173; login links
resolve to the actual portal route. Capture UI belongs to portal development tooling,
not the API Worker bundle; this final acceptance correction passed browser and runtime verification.

The actual disposable Wrangler rehearsal applied 23 migrations, exercised customer
request/capture/verify, rejected wrong-tenant token use and replay, preserved the
signed identity through a Worker restart, and cleared ephemeral capture. The last
completed run took 5.558 seconds and measured local state from 1,433,208 to 2,742,448
bytes. These are one synthetic run's disk measurements, not production capacity.
SIGINT/SIGTERM cleanup released both ports and deleted only run-owned temporary state.
No measured external request counter is claimed; the local transport disables mail.

Validation before the final UI relocation: server 339 tests, portal 12, widget 3;
root tooling 31 tests; relevant lint/typecheck, D1 smoke/integration, frontend builds
and semantic workflow validation passed. The real Wrangler rehearsal is added to CI.
Final UI keyboard/direct-load/reload checks passed; final portal suite is 13 tests.
Independent high-effort review passed, including production output exclusion and
three focused relocation tests. Required PR checks remain pending. #57 is not yet accepted.

## Active allocation and integration order

| Workstream | Agent/environment | Model/effort | Ownership/state |
| --- | --- | --- | --- |
| Coordination, real runtime acceptance | Root/local | Inherited session | Issue/Project/state, disposable runtime proof, integration |
| #57 local runtime/mail capture | beta_environment_impl/local checkout | gpt-5.6-terra/high | Authentication boundaries reviewed; dev UI relocation complete; final checks |
| Independent security review | release_packaging_escalation/Codex | gpt-6-astra/high | Runtime/helper review passed; final relocation review passed |
| #58 ready-plan refinement | dependency_audit/local | gpt-5.6-terra/medium | Read-only acceptance/interactive fixture preparation |
| Work pool review attempt | Existing Work task | Existing configuration | Connector timed out; execution unconfirmed |

Root owns this state and runtime rehearsal; application owner owns the local runtime,
portal capture UI and focused tests. Four concurrent Codex slots exist including root.
Work connector retries timed out and Computer Use explicitly denied native app access.
No macOS permission prompt was generated; no Mac permission is pending. Browser
Computer Use works and is used for local UI checks. No denied route is circumvented.

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

1. Finish independent review, publish the coherent local-runtime PR and require all CI/security checks.
2. Complete #57 local capture/runtime implementation and independent review; run actual
   loopback Wrangler auth, isolation, reset/retention and resource/recovery evidence.
3. Update local operator docs and #57 acceptance mapping. Integrate via coherent PR,
   then accept #57 only when current owner-directed local criteria are evidenced.
4. Continue #58 -> #19 -> #59 -> #60; unlock independent #63/#93/#61/#62 as specified.
5. Preserve state/issue/Project truth after meaningful delivery, merge or blocker;
   conserve automatic reviews by batching corrections and avoiding manual rerequests.
6. Keep the owner informed at least every 30 minutes while actively delivering.
