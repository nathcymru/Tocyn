import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { createServer } from 'node:net';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition: () => boolean | Promise<boolean>, message: string, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await pause(50);
  }
  assert.fail(message);
}
async function portFree(): Promise<boolean> {
  const probe = createServer();
  return new Promise(resolve => {
    probe.once('error', () => resolve(false));
    probe.listen(8787, '127.0.0.1', () => probe.close(() => resolve(true)));
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
  assert.ok(await portFree(), 'This test requires exclusive local port 8787');
  assert.ok(process.platform === 'darwin' || process.platform === 'linux', 'Local PTY proof requires macOS or Linux');
  for (const repeated of [false, true]) {
    const env: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
    delete env.CI;
    let terminal: ChildProcess | undefined;
    let output = '';
    let stateDirectory: string | undefined;
    let runDirectory: string | undefined;
    try {
      terminal = spawn('python3', ['-c', ptyBridge, 'npm', 'run', 'fixture:local-beta', '--workspace=apps/server'], { cwd: repositoryRoot, env, stdio: ['pipe', 'pipe', 'pipe'] });
      const capture = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > 128 * 1024) output = output.slice(-128 * 1024);
        const state = /Local operator state: ([^\r\n]+)/.exec(output)?.[1];
        if (state && basename(state) === 'state' && basename(dirname(state)).startsWith('tocyn-local-tenants-')) {
          stateDirectory = state;
          runDirectory = dirname(state);
        }
      };
      terminal.stdout!.on('data', capture);
      terminal.stderr!.on('data', capture);
      await until(() => !!stateDirectory && output.includes('Stop this command to erase its run-owned state.'),
        'Interactive guarded fixture must become ready without disclosing terminal output', 30000);
      assert.ok(runDirectory && existsSync(runDirectory));
      assert.ok(existsSync(resolve(runDirectory, '.dev.vars')), 'The actual fixture creates private local credentials');
      const health = await fetch('http://localhost:8787/health', { signal: AbortSignal.timeout(1000) });
      assert.equal(health.status, 200); await health.body?.cancel();
      output = '';
      terminal.stdin!.write('\x03');
      if (repeated) {
        await pause(25);
        terminal.stdin!.write('\x03');
      }
      await until(() => !existsSync(runDirectory!), 'Ctrl-C must remove the exact run-owned state and credentials');
      await until(portFree, 'Ctrl-C must release the local Worker port');
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
