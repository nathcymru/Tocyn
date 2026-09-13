# Tiny warm-render regression budget (#139)

This deliberately invoked specialist check applies only to the declared tiny fixture: two same-tenant tickets, one35-byte article each,20 same-context A→B→A cycles after A/B/A preparation, Apple M3/16GiB on AC, headless1280×800, reduced motion, Chromium 151.0.7922.34, Playwright 1.62.1 and Node 22.19.0. It is not a network SLA, statistical confidence bound, representative-workload result or complete #139 acceptance.

The accepted engineering rule is nearest-rank return-to-A p95 <=80ms. The measured44.3ms baseline plus approximately two60Hz frames (33.4ms), rounded upward, supplies a conservative scheduling-noise allowance. With20 raw returns, p95 is the19th sorted value. Stored summaries are ignored. The verifier also requires both complete20-leg series with unique cycle/leg IDs, finite nonnegative values, matching tiny fixture/environment declarations and successful status for any observed detail responses. Zero observed reads does not prove cache hits.

Run with Node22, without a browser or Worker:

```sh
node --test tools/ui-performance/check-warm-budget.test.mjs
node tools/ui-performance/check-warm-budget.mjs tools/ui-performance/fixtures/warm-tiny-087a2172.json tools/ui-performance/fixtures/warm-tiny-087a2172-provenance.json
```

A passing valid receipt exits0; a budget failure or malformed input exits1. The tests deliberately double the existing raw observations and prove p95 88.6ms fails, including CLI exit status. This synthetic negative is verifier evidence, not another measured run. Unsupported rule/metric overrides are rejected.

Expected provenance is mandatory and must be supplied independently by the trusted build/run handoff. Do not generate it from the candidate receipt being checked. For this historical baseline, the reviewed pinned provenance records revision087a2172fd434a6cacc120e932a52a1d7e82644d plus its dirty harness patch, exact artifact hashes and six source hashes. All six source hashes were independently checked: application paths against087a2172, and the two harness paths against subsequently signedf7173d6ebd028295e16f5258c760a50d77a6da47. Git comparisons to current base a2494baa show identical dashboard/portal/packages/server-src inputs; migration0077 and the newly introduced harness differ. The later main changes through a2494baa are documentation/policy only. No runtime measurement against a2494baa or database-equivalence claim is made. The baseline's dirty flag is retained honestly.

The copied original receipt was produced by the accepted specialist run: Chromium151.0.7922.34 / Playwright1.62.1,40 cold samples, two recovery samples and40 warm legs. It contains only synthetic fixture metadata/timing. Declared hardware/power and source/build metadata are checked, not independently attested by this verifier. A future candidate needs a separately trusted provenance handoff and matching declared condition; these files are not cryptographic proof that a browser run occurred.

No ordinary-CI specialist job is added. The medium profile remains deferred in draft293 and is excluded. Other #139 interaction metrics, representative/low-power evidence and immediate write-pending acceptance remain open; this check only advances the explicit material-regression-budget criterion.
