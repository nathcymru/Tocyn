const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const script = path.join(__dirname, 'reset-admin.js');
test('local reset generates unique strong passwords instead of a shared default', () => {
  const run = () => execFileSync(process.execPath, [script], { encoding: 'utf8' });
  const a = run(); const b = run();
  const password = text => text.match(/New Password: (.+)/)[1];
  assert.match(password(a), /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(password(a), password(b));
  assert.ok(!a.includes('Admin123!'));
  assert.ok(a.includes('--local'));
  assert.ok(!a.includes('--remote'));
});
test('reset escapes the SQL email literal and only targets administrators', () => {
  const result = execFileSync(process.execPath, [script, 'synthetic-password', "owner'example@example.test"], { encoding: 'utf8' });
  assert.ok(result.includes('AND role ='));
  assert.ok(!result.includes('--command "'));
});

test('legacy seed requires explicit selection and never replaces existing rows', () => {
  const { spawnSync } = require('node:child_process');
  const seed = path.join(__dirname, '../apps/server/src/scripts/seed.ts');
  const rejected = spawnSync(process.execPath, ['--import', 'tsx', seed], { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Legacy seed requires --legacy-schema/);
  assert.equal(rejected.stdout, '');
  const selected = spawnSync(process.execPath, ['--import', 'tsx', seed, '--legacy-schema'], { encoding: 'utf8' });
  assert.equal(selected.status, 0);
  assert.ok(!selected.stdout.includes('OR REPLACE'));
  assert.ok(selected.stdout.includes('INSERT OR IGNORE'));
  assert.match(selected.stderr, /NOT APPLIED/);
});
