import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const helper = new URL('../../.github/scripts/run-bounded-command.sh', import.meta.url);
const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

function runBounded(name, seconds, program) {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-ci-observability-'));
  const logPath = join(directory, `${name}.log`);
  // macOS does not ship GNU timeout. This small test-only shim preserves the
  // helper's command contract and makes the stalled path deterministic locally.
  const timeout = join(directory, 'timeout');
  writeFileSync(timeout, `#!/usr/bin/env bash
set -euo pipefail
while [[ "$1" == --* ]]; do shift; done
limit="\${1%s}"; shift
"$@" & child=$!
(sleep "$limit"; kill -TERM "$child" 2>/dev/null || true) & watcher=$!
set +e
wait "$child"; status=$?
set -e
kill "$watcher" 2>/dev/null || true
wait "$watcher" 2>/dev/null || true
if [[ "$status" -eq 143 ]]; then exit 124; fi
exit "$status"
`);
  chmodSync(timeout, 0o755);
  const result = spawnSync('bash', [helper.pathname, name, String(seconds), logPath, '--', process.execPath, '-e', program], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }
  });
  return { ...result, directory, logPath };
}

test('bounded CI helper names, logs and returns a failing command', () => {
  const result = runBounded('known-failure', 1, "console.error('synthetic failure'); process.exit(7)");
  try {
    assert.equal(result.status, 7, result.stderr);
    assert.match(result.stderr, /known-failure.*exit 7/);
    const log = readFileSync(result.logPath, 'utf8');
    assert.match(log, /Running bounded CI test: known-failure/);
    assert.match(log, /synthetic failure/);
    assert.match(log, /Finished bounded CI test: known-failure \(exit 7/);
  } finally {
    rmSync(result.directory, { recursive: true, force: true });
  }
});

test('bounded CI helper terminates a stalled command and retains its named log', () => {
  const result = runBounded('known-stall', 1, 'setTimeout(() => {}, 10_000)');
  try {
    assert.equal(result.status, 124, result.stderr);
    assert.match(result.stderr, /known-stall.*exit 124/);
    const log = readFileSync(result.logPath, 'utf8');
    assert.match(log, /Running bounded CI test: known-stall/);
    assert.match(log, /Finished bounded CI test: known-stall \(exit 124/);
  } finally {
    rmSync(result.directory, { recursive: true, force: true });
  }
});

test('required CI keeps named bounded diagnostics and every current admission runtime', () => {
  assert.match(workflow, /timeout-minutes: \$\{\{ matrix\.check == 'test' && 90 \|\| 20 \}\}/);
  assert.match(workflow, /Verify bounded general test suite/);
  assert.match(workflow, /Verify bounded budget admission and durable recovery/);
  assert.match(workflow, /run-bounded-command\.sh "\$name" 360 "\$diagnostics\/\$name\.log"/);
  assert.match(workflow, /budget-admission-runtime\.test\.ts/);
  assert.match(workflow, /if: always\(\) && matrix\.check == 'test'/);
  assert.match(workflow, /tocyn-test-diagnostics/);
  assert.match(workflow, /tocyn-budget-admission/);
});
