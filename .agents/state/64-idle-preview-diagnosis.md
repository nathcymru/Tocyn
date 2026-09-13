# #64 local preview idle diagnosis — 13 September 2026

Source: merged `c074805f`, isolated branch `codex/64-idle-recovery`. No application guard, admission ceiling, expiry rule or production source changed. Existing user preview processes remained untouched. GPT native execution was required to observe real Worker eviction; no worker prompts or private state were published.

The preview used Miniflare `unsafeEphemeralDurableObjects:true`. A minimal counter fixture without a retained external DO stub returned 1 before real 65-second idle and 1 afterward: its stored counter was lost. In the exact synthetic preview startup (two tenants, full resource catalogue, admin login/MFA and SLA setup),40 detail reads succeeded, then real 65-second idle yielded preferences/SLA 200 but detail 429. A diagnostic run found the local expired holder's original reservation absent centrally; recovery correctly rejected the missing reservation rather than fabricate closure or release liability. The live fixture's pending closure pattern was not directly reconstructed because its DO state was ephemeral and unavailable through the existing diagnostic surface.

Holding an external direct DO stub while inspecting before idle changed the result and masked the failure. Simulated-clock tests also passed because they did not exercise real idle eviction. Those passing results did not clear the long-lived preview gate.

The identical synthetic preview with local-disk DO storage, no retained external stub and unchanged 64-reservation/60-second-grant policy passed two cycles of 40 detail reads followed by 65 seconds of real idle. After each idle, preferences, SLA and three detail reads returned 200. Exact expired grant targets remained available for confirmed recovery. Both runtimes were disposed after execution; current/old user previews were not restarted or reset.

An explicitly invoked native acceptance test is added at `apps/server/scripts/durable-object-idle-persistence-runtime.test.ts`. It checks local-disk counter continuity across real 65-second idle without retaining an external stub. It is not added to ordinary CI. Executed result: 1/1 passed in 65.6 seconds on Node 22.19. Focused TypeScript and ESLint passed. No ordinary workspace unit rerun was needed for this test/documentation-only increment.

Evidence logs are local synthetic artifacts: `/tmp/64-ephemeral-counter-proof.log`, `/tmp/64-exact-preview-original-stage.log`, `/tmp/64-persistent-unpinned-two-cycles.log`. No auth secrets or full coordinator state are included in this receipt. Preview replacement still requires coordinator acceptance; #64 and Beta.2 remain incomplete.

The delivery branch was subsequently fast-forwarded to signed main `2d7c5c12` without changing application code; the independent counter test imports no application implementation. The full preview observations above remain evidence for their stated `c074805f` source, not unexecuted later feature changes.
