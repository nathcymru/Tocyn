#!/usr/bin/env bash
set -euo pipefail

diagnostics_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tocyn-test-diagnostics"
runner="$(dirname "$0")/run-bounded-command.sh"

run_check() {
  local name="$1"
  local limit="$2"
  shift 2
  bash "$runner" "$name" "$limit" "$diagnostics_root/$name.log" -- "$@"
}

# Keep the existing test suite intact while making the command currently in
# flight and every subsequent runtime test attributable in CI logs/artifacts.
run_check workspace-tests 900 npm test
run_check rehearsal-runtime 300 npm run test:rehearsal-runtime
run_check utc-timestamp 120 env TZ=Europe/London npm exec --workspace=apps/dashboard -- vitest run src/__tests__/utcTimestamp.test.ts
run_check d1-smoke 180 bash -lc 'cd apps/server && bash ./scripts/d1-smoke-test.sh'
run_check d1-integration 300 bash -lc 'cd apps/server && npx tsx scripts/d1-integration-test.ts'
run_check local-auth-smoke 180 bash -lc 'cd apps/server && node scripts/local-auth-smoke.mjs'
run_check local-tenant-fixture 180 bash -lc 'cd apps/server && npx tsx scripts/verify-local-tenant-fixture.ts'
run_check local-tenants-focused 240 bash -lc 'cd apps/server && npm run test:local-tenants:focused'
run_check tenant-isolation-core 240 bash -lc 'cd apps/server && npm run test:tenant-isolation-core'
run_check tenant-isolation-storage-background 300 bash -lc 'cd apps/server && npm run test:tenant-isolation-storage-background'
run_check local-tenant-realtime 240 bash -lc 'cd apps/server && npm run test:local-tenant-realtime'
run_check canonical-conversation 240 bash -lc 'cd apps/server && npm run test:canonical-conversation'
run_check canonical-conversation-atomic 300 bash -lc 'cd apps/server && npm run test:canonical-conversation-atomic'
run_check ticket-mutation-replay 300 bash -lc 'cd apps/server && npm run test:ticket-mutation-replay'
run_check conversation-audit 240 bash -lc 'cd apps/server && npm run test:conversation-audit'
run_check local-beta 300 bash -lc 'cd apps/server && npm run test:local-beta'
run_check local-beta-runtime 300 bash -lc 'cd apps/server && npm run test:local-beta-runtime'
run_check operator-workflow 300 bash -lc 'cd apps/server && npm run test:operator-workflow'
run_check operator-activity 300 bash -lc 'cd apps/server && npm run test:operator-activity'
run_check local-portal-workflow 300 bash -lc 'cd apps/server && npm run test:local-portal-workflow'
run_check observability-config 180 bash -lc 'cd apps/server && npm run test:observability-config'
run_check local-observability-collector 240 bash -lc 'cd apps/server && npm run test:local-observability-collector'
run_check operational-performance 300 bash -lc 'cd apps/server && npm run test:operational-performance'
run_check api-key-admin-admission 300 bash -lc 'cd apps/server && npm run test:api-key-admin-admission-runtime'
run_check channel-configuration-admission 300 bash -lc 'cd apps/server && npm run test:channel-configuration-admission-runtime'
run_check operational-performance-evidence 180 bash -lc 'cd apps/server && npm run evidence:operational-performance'
