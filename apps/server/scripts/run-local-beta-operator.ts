import { openLocalBetaState } from './local-beta-state';
import { lstatSync, readFileSync } from 'node:fs';
import { LocalBetaOperator } from './local-beta-operator';

// No Wrangler network/config discovery. This CLI opens only existing local D1 simulation state.
function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  const options = new Map<string, string>();
  while (args.length) {
    const key = args.shift()!;
    if (key === '--local') { if (options.has(key)) throw new Error('Duplicate flag'); options.set(key, 'true'); continue; }
    if (!['--persist-to', '--expected-revision', '--policy'].includes(key) || options.has(key) || !args.length) throw new Error('Unknown or duplicate option');
    options.set(key, args.shift()!);
  }
  if (options.get('--local') !== 'true' || !options.has('--persist-to') || !['status', 'initialize', 'new-run', 'stop-intake', 'stop-writes', 'resume'].includes(command ?? '')) throw new Error('Use status|initialize|new-run|stop-intake|stop-writes|resume --local --persist-to <existing local state directory>');
  const db = openLocalBetaState(options.get('--persist-to')!);
  try {
    const operator = new LocalBetaOperator(db);
    let result;
    if (command === 'status') result = operator.status();
    else {
      const raw = options.get('--expected-revision');
      if (!raw || !/^(0|[1-9][0-9]*)$/.test(raw)) throw new Error('Explicit --expected-revision is required');
      const revision = Number(raw);
      if (command === 'initialize' || command === 'new-run') {
        if (!options.has('--policy') || (command === 'initialize' ? revision !== 0 : revision < 1)) throw new Error('Use an explicit policy file and the correct revision for initialization or a new run');
        const file = options.get('--policy')!;
        if (lstatSync(file).size > 32768) throw new Error('Policy file exceeds 32 KiB');
        const policy = JSON.parse(readFileSync(file, 'utf8'));
        if (JSON.stringify([...policy.tenants].sort()) !== JSON.stringify(['fixture-tenant-a', 'fixture-tenant-b'])) throw new Error('Only the two approved local fixture tenants may be enabled');
        result = operator.initialize(policy, revision);
      } else result = operator.change(command as 'stop-intake' | 'stop-writes' | 'resume', revision);
    }
    // Aggregate operator-only output; never credentials, invitation IDs or message content.
    process.stdout.write(JSON.stringify(result ?? { state: 'uninitialized' }) + '\n');
  } finally { db.close(); }
}
try { main(); } catch { process.stderr.write('Local operator command rejected. Check the local state, command, policy format and expected revision. No sensitive input is reported.\n'); process.exitCode = 1; }
