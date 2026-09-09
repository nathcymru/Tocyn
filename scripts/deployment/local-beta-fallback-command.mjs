// Invoked only as an owned local Node/tsx subprocess by the rehearsal controller.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RehearsalLifecycle } from './local-beta-rehearsal.mjs';
import { runSameStateFallback } from './local-beta-same-state-runtime.ts';

async function main() {
  const [requestPath] = process.argv.slice(2);
  const request = JSON.parse(readFileSync(requestPath, 'utf8'));
  const taskRoot = join(request.taskRoot, 'fallback-runtime');
  mkdirSync(taskRoot, { mode: 0o700 });
  const receipt = { commands: [], cleanup: 'pending' };
  const lifecycle = new RehearsalLifecycle(taskRoot, receipt, { failedOutputDirectory: request.failedOutputDirectory });
  let result;
  try {
    result = await runSameStateFallback({ candidate: request.candidate, knownGood: request.knownGood, taskRoot, lifecycle });
  } finally {
    try { await lifecycle.cleanup(); receipt.cleanup = 'disposed'; }
    catch { receipt.cleanup = 'incomplete'; throw new Error('Local fallback cleanup incomplete'); }
    finally { writeFileSync(request.receiptPath, JSON.stringify({ result, ...receipt }), { mode: 0o600 }); }
  }
  if (result.fallback !== 'passed') throw new Error('Local fallback is unavailable');
}
main().catch(() => { process.exitCode = 1; });
