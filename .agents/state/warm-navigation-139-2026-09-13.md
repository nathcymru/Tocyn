# Operator warm navigation: partial #139 evidence

Progresses #139. The specialist authenticated-navigation harness now has an explicit `TOCYN_UI_AUTH_WARM=1` option. Its existing 20 fresh-context samples per client and two recovery samples remain unchanged. After those measurements, two canonical same-tenant synthetic tickets are created, each with one 35-byte article. Three unmeasured visits A/B/A precede 20 same-context A→B→A cycles. The browser records click-to-visible-heading-and-body plus two animation frames; response completion is reported separately only for detail responses observed before useful-render detection. No cache hit is inferred from absence of observed responses.

Historical first run: source base `75c5a1d3e18eb603ac3f96503a85b962afe2963d` plus the uncommitted harness patch, before later main changes. Both dashboard and portal were built from that checkout. All 40 cold, two recovery and 40 warm-leg samples passed. Return-to-A p50 36.2 ms / p95 46.2 ms; zero detail responses were observed within those warm render windows. This is not network completion evidence or a regression threshold. The local raw receipt retains exact source/build hashes at `.agent-context/139-warm-receipt.json` in the isolated worktree.

Environment: Node22.19.0, Playwright1.62.1, official Chrome Headless Shell151.0.7922.34/build1234, AppleM3/16GiB, AC attached (battery76%, not charging at preflight), headless1280×800/reduced motion. Official shell and CLI-required FFmpeg1011 were downloaded after the initial run found no browser executable; no npm reinstall or user browser/profile changes. Successful specialist run took63.1s and disposed its browser/fixture. Typecheck with existing `scripts/tsconfig.ui-authenticated-navigation.json`, observer-script parsing, both client builds and diff checks passed. Initial ad-hoc typecheck used incorrect environment configuration; the existing specialist configuration passed.

Reproduce from matching client builds, with the native slot free:

```sh
TOCYN_UI_AUTH_SAMPLES=20 TOCYN_UI_AUTH_WARM=1 TOCYN_UI_HARDWARE_LABEL='actual hardware' TOCYN_UI_POWER_STATE='actual power state' node --import tsx --test apps/server/scripts/ui-authenticated-navigation.test.ts
```

Use installed Node22 and matching Playwright browser. The fixture is synthetic, local, admission-disabled and ephemeral; this does not validate sustained budgeted Beta2 runtime. Larger threads, low-power hardware, other approved interactions, degraded-network distributions and measured regression budgets remain open. No ordinary-CI specialist task or threshold was added. Preserve Project progress and baseline/forecast/actual dates: there is no defensible new acceptance weighting from this small fixture. No release or issue completion claim.

Routing: GPT performed bounded consequential harness work directly. No model calls or Copilot requests; latest reported local free memory3.83GiB was below the4GiB cold-model guard, so local inference stayed unloaded. Shared weekly Codex32% remaining and Spark2% were reported by the coordinator; no independent allowance or paid fallback was assumed.

Latest-app validation after #290: rebuilt dashboard and portal at `087a2172fd434a6cacc120e932a52a1d7e82644d` plus the same harness patch, then reran the approved 20-sample specialist. All 40 cold / two recovery / 40 warm-leg samples passed in 59.3s. Return-to-A p50 35.2 ms / p95 44.3 ms; 0 detail responses observed before render detection. Latest raw receipt retains exact artifact/source hashes; first receipt is preserved locally as `139-warm-receipt-75c5.json`. Existing specialist TypeScript configuration also passed against latest main. These results still evaluate no regression threshold.
