// Static, synthetic process fixtures. Paths and options arrive as data, never source text.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const self = fileURLToPath(import.meta.url);
const [mode = process.env.REHEARSAL_FIXTURE_MODE, ...args] = process.argv.slice(2);
const idle = () => setInterval(() => {}, 1000);

if (mode === 'output') {
  // Fixed synthetic bytes exercise draining and failure retention without code generation.
  process.stdout.write('x'.repeat(Number(args[1] || 0)));
  process.stderr.write('synthetic-private-tail\n');
  process.exitCode = Number(args[0]);
} else if (mode === 'idle') {
  if (args[0] === 'ignore-term') process.on('SIGTERM', () => {});
  idle();
} else if (mode === 'npm-nested') {
  const nested = spawn(process.execPath, [self, 'idle', 'ignore-term'], { detached: true, stdio: 'ignore' });
  nested.unref();
  writeFileSync(process.env.GRANDCHILD_PID, String(nested.pid));
  process.on('SIGINT', () => {}); process.on('SIGTERM', () => {});
  writeFileSync(process.env.READY, 'ready'); idle();
} else if (mode === 'controller') {
  const { RehearsalLifecycle, installSignalCleanup } = await import('../local-beta-rehearsal.mjs');
  const [task, fixture, receiptPath] = args;
  mkdirSync(task, { recursive: true, mode: 0o700 });
  const receipt = { commands: [], cleanup: 'pending' };
  const lifecycle = new RehearsalLifecycle(task, receipt, { failedOutputDirectory: process.env.REHEARSAL_FAILED_OUTPUT_DIRECTORY, ownsFailedOutputDirectory: !!process.env.REHEARSAL_FAILED_OUTPUT_DIRECTORY });
  installSignalCleanup(lifecycle, receipt, receiptPath);
  void lifecycle.run('npm', ['run', 'fixture'], fixture, process.env).catch(() => {});
} else if (mode === 'leader') {
  const children = [false, true].map(detached => {
    const child = spawn(process.execPath, [self, 'idle'], { detached, stdio: 'ignore', env: { PATH: process.env.PATH } });
    child.unref(); return child.pid;
  });
  writeFileSync(args[0], JSON.stringify(children)); process.exit(0);
} else if (mode === 'late') {
  const [ready, result] = args;
  process.on('SIGTERM', () => {
    try { spawn(process.execPath, [self, 'idle'], { detached: true, stdio: 'ignore' }); writeFileSync(result, 'escaped'); }
    catch { writeFileSync(result, 'rejected'); }
    process.exit(0);
  });
  writeFileSync(ready, 'ready'); idle();
} else if (mode === 'detached-child') {
  const child = spawn(process.execPath, [self, 'idle'], { detached: true, stdio: 'ignore', env: { PATH: process.env.PATH, NODE_OPTIONS: '--no-warnings' } });
  child.unref(); writeFileSync(args[0], String(child.pid)); idle();
} else if (mode === 'inner') {
  const { RehearsalLifecycle } = await import('../local-beta-rehearsal.mjs');
  const [task, cwd, pids] = args;
  const lifecycle = new RehearsalLifecycle(task, { commands: [] });
  lifecycle.startService(process.execPath, [self, 'detached-child', pids], cwd, process.env);
  process.on('SIGTERM', () => {}); idle();
} else if (mode === 'wrangler') {
  const options = JSON.parse(process.env.WRANGLER_ARGS);
  spawn(process.execPath, options, { detached: true, stdio: 'ignore' });
  process.on('SIGTERM', () => {}); idle();
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:8787/health', { redirect: 'error', signal: AbortSignal.timeout(300) });
      await response.body?.cancel();
      if (response.status === 200) { writeFileSync(process.env.READY, 'ready'); break; }
    } catch { /* Bounded readiness wait for the owned local Worker. */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
} else throw new Error('Unknown synthetic process fixture');
