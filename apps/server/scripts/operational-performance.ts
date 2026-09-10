/** Bounded local evidence only. Measurements do not establish production SLOs. */
export async function measureOperations(options: {
  samples: number; concurrency: number; expectedStatus: number;
  run: () => Promise<{status: number}>; now?: () => number;
}) {
  const {samples, concurrency, expectedStatus, run} = options;
  if (!Number.isInteger(samples) || samples < 1 || samples > 1000
    || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 || concurrency > samples
    || !Number.isInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599) throw new Error('Invalid measurement bounds');
  const now = options.now ?? (() => performance.now());
  let cursor = 0;
  const results: {latencyMs:number; matched:boolean; transportFailure:boolean}[] = [];
  const start = now();
  await Promise.all(Array.from({length:concurrency}, async () => {
    while (cursor < samples) {
      cursor++;
      const began = now();
      let matched = false;
      let transportFailure = false;
      try { matched = (await run()).status === expectedStatus; }
      catch { transportFailure = true; }
      const latencyMs = now() - began;
      if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new Error('Invalid measurement clock');
      results.push({latencyMs, matched, transportFailure});
    }
  }));
  const elapsedMs = now() - start;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('Invalid measurement clock');
  const ordered = results.map(result=>result.latencyMs).sort((a,b)=>a-b);
  const percentile = (fraction:number) => ordered[Math.max(0, Math.ceil(ordered.length*fraction)-1)];
  return {
    samples, concurrency, expectedStatus, elapsedMs,
    expectedResponses:results.filter(result=>result.matched).length,
    unexpectedResponses:results.filter(result=>!result.matched && !result.transportFailure).length,
    transportFailures:results.filter(result=>result.transportFailure).length,
    latencyMs:{min:ordered[0],p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),max:ordered[ordered.length-1]},
    percentileMethod:'nearest-rank' as const,
  };
}
