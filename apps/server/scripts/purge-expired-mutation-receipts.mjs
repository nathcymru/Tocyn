import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicitly selected existing local state only. No default state or remote mode.
let temporary;
try {
  const args = process.argv.slice(2);
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!['--local', '--persist-to', '--tenant', '--limit'].includes(name) || options.has(name)) throw new Error('Invalid options');
    if (name === '--local') options.set(name, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing option value');
      options.set(name, value);
    }
  }
  if (!options.get('--local') || !options.get('--persist-to') || !options.get('--tenant')) throw new Error('Explicit local state and tenant required');
  const state = realpathSync(resolve(options.get('--persist-to')));
  if (!statSync(state).isDirectory()) throw new Error('Local state must be a directory');
  const tenant = options.get('--tenant');
  if (tenant.length > 256 || /[\x00-\x1f\x7f]/.test(tenant)) throw new Error('Invalid tenant');
  const limit = options.has('--limit') ? Number(options.get('--limit')) : 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid limit');
  temporary = mkdtempSync(join(tmpdir(), 'tocyn-receipt-purge-'));
  const sqlPath = join(temporary, 'purge.sql');
  writeFileSync(sqlPath, `DELETE FROM ticket_mutation_receipts WHERE rowid IN
    (SELECT rowid FROM ticket_mutation_receipts WHERE tenant_id = '${tenant.replaceAll("'", "''")}'
      AND expires_at <= unixepoch() ORDER BY expires_at LIMIT ${limit}) RETURNING 1 AS deleted;`, { mode: 0o600 });
  const server = dirname(dirname(fileURLToPath(import.meta.url)));
  const stdout = execFileSync(process.execPath, [join(server, '../../node_modules/wrangler/bin/wrangler.js'),
    'd1', 'execute', 'tocyn-local', '--local', '--config', join(server, 'wrangler.local.json'),
    '--persist-to', state, '--file', sqlPath, '--json'], {
    cwd: server, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  const result = JSON.parse(stdout);
  if (!Array.isArray(result) || result.length !== 1 || result[0].success !== true ||
      !Array.isArray(result[0].results) || result[0].results.length > limit ||
      !result[0].results.every(row => row.deleted === 1 && Object.keys(row).length === 1)) throw new Error('Unexpected purge result');
  console.log(JSON.stringify({ result: 'passed', mode: 'local-only', maximumRows: limit, deletedRows: result[0].results.length }));
} catch {
  console.error('Local receipt purge failed. Required: --local --persist-to EXISTING_LOCAL_STATE --tenant TENANT [--limit 1..100].');
  process.exitCode = 1;
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
