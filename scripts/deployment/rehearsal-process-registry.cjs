// Local rehearsal tooling only. Never import into an application or deployable bundle.
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const originalExecFileSync = cp.execFileSync;
const LIMIT = 4096;
function checkDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Invalid rehearsal ownership directory');
  let stat;
  try { stat = fs.lstatSync(directory); }
  catch { throw new Error('Invalid rehearsal ownership directory'); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid()) throw new Error('Invalid rehearsal ownership directory');
}
function privateWrite(file, value) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, value); } finally { fs.closeSync(fd); }
}
function snapshot() {
  const output = originalExecFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,lstart='], { encoding: 'utf8', detached: true, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 2000 });
  return output.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) return [];
    const [, pid, ppid, pgid, state, start] = match;
    let identity = start;
    if (process.platform === 'linux') {
      try { const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); identity = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19]; } catch { return []; }
    }
    return [{ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), start: identity, zombie: state.startsWith('Z') }];
  });
}
function record(directory, processInfo) {
  checkDirectory(directory);
  if (!processInfo || processInfo.pid <= 1 || !processInfo.start) return;
  const name = `${processInfo.pid}-${createHash('sha256').update(processInfo.start).digest('hex').slice(0, 24)}.json`;
  if (fs.existsSync(path.join(directory, name))) return;
  if (fs.readdirSync(directory).length >= LIMIT) throw new Error('Rehearsal process registry limit exceeded');
  try { privateWrite(path.join(directory, name), JSON.stringify(processInfo)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
function register(directory, pid) { const info = snapshot().find(value => value.pid === pid); if (info) record(directory, info); }
function read(directory) {
  checkDirectory(directory);
  const names = fs.readdirSync(directory);
  if (names.length >= LIMIT || names.includes('failed')) throw new Error('Rehearsal process registration incomplete');
  return names.filter(name => /^\d+-[a-f0-9]{24}\.json$/.test(name)).map(name => {
    const file = path.join(directory, name); const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 || (stat.mode & 0o077) || stat.uid !== process.getuid()) throw new Error('Invalid rehearsal process record');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isSafeInteger(value.pid) || value.pid <= 1 || !Number.isSafeInteger(value.pgid) || typeof value.start !== 'string' || !value.start) throw new Error('Invalid rehearsal process identity');
    return value;
  });
}
function markFailed(directory) { try { privateWrite(path.join(directory, 'failed'), 'registration failed'); } catch { /* Existing failure is retained. */ } }
module.exports = { checkDirectory, privateWrite, snapshot, record, register, read, markFailed };
