import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import * as OTPAuth from 'otpauth';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition: () => boolean | Promise<boolean>, message: string | (() => string), timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await pause(50);
  }
  assert.fail(typeof message === 'string' ? message : message());
}
async function sparePort(): Promise<number> {
  const probe = createServer();
  return new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') { probe.close(); reject(new Error('Isolated fixture port unavailable')); return; }
      probe.close(() => resolve(address.port));
    });
  });
}
async function portFree(port: number): Promise<boolean> {
  const probe = createServer();
  return new Promise(resolve => {
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

// Python's standard-library PTY bridge supplies a real controlling terminal on macOS/Linux.
// Unlike macOS script(1), it also works when the test runner itself has piped streams.
const ptyBridge = String.raw`
import errno, os, pty, select, signal, sys
pid, master = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
def stop(*_):
    try: os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError: pass
signal.signal(signal.SIGTERM, stop)
inputs = [master, 0]
while True:
    ready, _, _ = select.select(inputs, [], [], 1)
    for fd in ready:
        try: data = os.read(fd, 65536)
        except OSError as error:
            if error.errno == errno.EIO: data = b''
            else: raise
        if not data:
            if fd == master:
                os.waitpid(pid, 0)
                sys.exit(0)
            inputs.remove(fd)
        elif fd == master: os.write(1, data)
        else: os.write(master, data)
`;

// The PTY runs the supported npm command with all three child streams as terminals.
// Output includes synthetic credentials: retain it only in memory and never include it in errors.
test('supported interactive npm beta launcher removes credentials/state after Ctrl-C and repeated Ctrl-C', async t => {
  const port = await sparePort();
  assert.notEqual(port, 8787, 'The launcher test must never use the existing fixture port');
  assert.ok(await portFree(port), 'This test requires an isolated free local port');
  assert.ok(process.platform === 'darwin' || process.platform === 'linux', 'Local PTY proof requires macOS or Linux');
  for (const repeated of [false, true]) {
    const env: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', TOCYN_LOCAL_FIXTURE_TEST_PORT: String(port) };
    delete env.CI;
    let terminal: ChildProcess | undefined;
    let output = '';
    let stateDirectory: string | undefined;
    let runDirectory: string | undefined;
    const existingRuns = new Set(readdirSync(tmpdir()).filter(name => name.startsWith('tocyn-local-tenants-')));
    try {
      terminal = spawn('python3', ['-c', ptyBridge, 'npm', 'run', 'fixture:local-beta', '--workspace=apps/server'], { cwd: repositoryRoot, env, stdio: ['pipe', 'pipe', 'pipe'] });
      const capture = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > 128 * 1024) output = output.slice(-128 * 1024);
      };
      terminal.stdout!.on('data', capture);
      terminal.stderr!.on('data', capture);
      await until(() => {
        const newRuns = readdirSync(tmpdir()).filter(name => name.startsWith('tocyn-local-tenants-') && !existingRuns.has(name));
        if (newRuns.length !== 1) return false;
        runDirectory = join(tmpdir(), newRuns[0]);
        stateDirectory = join(runDirectory, 'state');
        return existsSync(stateDirectory) && output.includes('READY') && output.includes('Press Ctrl+C to stop the server and erase its run-owned state.');
      }, () => `Interactive guarded fixture must become ready without disclosing terminal output. ${
        output.match(/Local tenant fixture did not start: ([^\r\n]+)/)?.[1] ?? 'No sanitized startup error reported.'
      }`, 45000);
      assert.ok(runDirectory && existsSync(runDirectory));
      assert.ok(existsSync(resolve(runDirectory, '.dev.vars')), 'The actual fixture creates private local credentials');
      const origin = `http://localhost:${port}`;
      const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) });
      assert.equal(health.status, 200); await health.body?.cancel();
      const operator = output.match(/Email: fixture\.operator\.a@example\.test\r?\nPassword: ([^\r\n]+)\r?\nOperator TOTP enrollment URI: ([^\r\n]+)/);
      assert.ok(operator, 'The run-owned launcher must print one synthetic operator credential');
      const request = (path: string, init: RequestInit = {}) => fetch(`${origin}${path}`, {
        ...init, redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      const login = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'fixture.operator.a@example.test', password: operator[1] }) });
      assert.equal(login.status, 200, 'The synthetic operator must reach MFA challenge');
      const challenge = await login.json() as { token: string };
      const authenticator = OTPAuth.URI.parse(operator[2]) as OTPAuth.TOTP;
      const verified = await request('/api/auth/mfa/verify', { method: 'POST',
        headers: { Authorization: `Bearer ${challenge.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: authenticator.generate() }) });
      assert.equal(verified.status, 200, 'Budgeted MFA verification must complete in the actual local Worker');
      const session = await verified.json() as { token: string };
      const priority = await request('/api/tickets?sort=priority_focus&limit=20', {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      assert.equal(priority.status, 200, 'The admitted, authenticated priority queue must be available');
      const body = await priority.json() as { data: Array<{ id: string; priority_category: string | null;
        contract_sla_tier: string | null; criticality_tier: number | null }>;
        meta: { total: number }; triageOverdueCount: number;
        priorityClocks: Record<string, { remainingHours: number; paused: boolean } | null> };
      assert.equal(body.meta.total, 20);
      assert.equal(body.data.length, 20);
      assert.ok(body.data.every(ticket => ticket.id.startsWith('beta2-') && ticket.priority_category
        && ticket.contract_sla_tier && ticket.criticality_tier));
      assert.ok(body.triageOverdueCount >= 2);
      assert.ok(body.data.every(ticket => body.priorityClocks[ticket.id] && Number.isFinite(body.priorityClocks[ticket.id]?.remainingHours)));
      assert.equal(Object.hasOwn(body.priorityClocks, 'beta2-b-email'), false);
      const attachment = await request('/api/attachments/beta2-attachment-pdf/download', {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      assert.equal(attachment.status, 200,
        `The real run-owned R2 object must match the seeded attachment row: ${attachment.status === 200 ? '' : await attachment.clone().text()}`);
      assert.equal(attachment.headers.get('content-type'), 'application/pdf');
      assert.ok((await attachment.text()).startsWith('%PDF-1.4'));
      const foreignAttachment = await request('/api/attachments/beta2-attachment-image/download', {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      assert.equal(foreignAttachment.status, 404, 'Tenant-A operator cannot download tenant-B seeded bytes');
      await foreignAttachment.body?.cancel();
      output = '';
      terminal.stdin!.write('\x03');
      if (repeated) {
        await pause(25);
        terminal.stdin!.write('\x03');
      }
      await until(() => !existsSync(runDirectory!), 'Ctrl-C must remove the exact run-owned state and credentials');
      await until(() => portFree(port), 'Ctrl-C must release the isolated local Worker port');
      await until(() => terminal!.exitCode !== null || terminal!.signalCode !== null, 'The supported npm terminal must exit');
      assert.equal(existsSync(runDirectory), false);
    } finally {
      output = '';
      if (terminal && terminal.exitCode === null && terminal.signalCode === null) terminal.kill('SIGTERM');
      // Emergency cleanup is restricted to the generated path observed from this owned launcher.
      if (runDirectory && existsSync(runDirectory)) rmSync(runDirectory, { recursive: true, force: true });
    }
  }
  t.diagnostic(JSON.stringify({ launch: 'npm-with-real-pty', ctrlC: true, repeatedCtrlC: true, remainingStateDirectories: 0, credentialOutput: false }));
});
