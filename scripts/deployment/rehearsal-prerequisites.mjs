import { spawnSync } from 'node:child_process';

export function pythonPtyAvailable(searchPath = process.env.PATH) {
  const result = spawnSync('python3', ['-I', '-c', 'import pty'], { env: { PATH: searchPath || '' }, stdio: 'ignore', timeout: 3000 });
  return !result.error && result.status === 0;
}
export function assertPythonPty(searchPath = process.env.PATH) {
  if (!pythonPtyAvailable(searchPath)) throw new Error('Local rehearsal requires python3 with the pty module; interruption acceptance has not run');
}
