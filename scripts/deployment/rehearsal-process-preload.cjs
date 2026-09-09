// Opt-in local Node launcher instrumentation; no application/runtime imports.
const directory = process.env.TOCYN_REHEARSAL_PROCESS_REGISTRY;
if (directory) {
  const cp = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const { syncBuiltinESMExports } = require('node:module');
  const registry = require('./rehearsal-process-registry.cjs');
  let directories;
  try {
    const ancestors = JSON.parse(process.env.TOCYN_REHEARSAL_ANCESTOR_REGISTRIES || '[]');
    if (!Array.isArray(ancestors) || ancestors.length > 16 || ancestors.some(value => typeof value !== 'string')) throw new Error('Invalid ownership ancestors');
    directories = [...new Set([...ancestors, directory])];
    for (const scope of directories) { registry.checkDirectory(scope); registry.register(scope, process.pid); }
  } catch { registry.markFailed(directory); process.exit(1); }
  const closed = scopes => scopes.some(scope => fs.existsSync(path.join(scope, 'closing')));
  if (closed(directories)) process.exit(1);
  const original = cp.ChildProcess.prototype.spawn;
  cp.ChildProcess.prototype.spawn = function(options) {
    const requested = (options.envPairs || []).find(value => value.startsWith('TOCYN_REHEARSAL_PROCESS_REGISTRY='))?.slice(33);
    const childScope = requested || directory;
    // An inner rehearsal service remains owned by its outer command as well.
    const scopes = [...new Set([...directories, childScope])];
    const taskRoot = fs.realpathSync(path.dirname(path.dirname(directories[0])));
    for (const scope of scopes) {
      registry.checkDirectory(scope);
      const relative = path.relative(taskRoot, fs.realpathSync(scope));
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Rehearsal registry escapes its owned task');
    }
    if (closed(scopes)) throw new Error('Local rehearsal process scope is closing');
    const locks = [];
    try {
      for (const scope of scopes) {
        const lock = path.join(scope, `spawning-${process.pid}`);
        registry.privateWrite(lock, 'spawning'); locks.push(lock);
      }
      if (closed(scopes)) throw new Error('Local rehearsal process scope is closing');
      const nodeOptions = (options.envPairs || []).find(value => value.startsWith('NODE_OPTIONS='))?.slice(13) || '';
      const pairs = (options.envPairs || []).filter(value => !/^(NODE_OPTIONS|TOCYN_REHEARSAL_PROCESS_REGISTRY|TOCYN_REHEARSAL_ANCESTOR_REGISTRIES)=/.test(value));
      const preloadOption = `--require=${JSON.stringify(__filename)}`;
      const inheritedOptions = nodeOptions.includes(preloadOption) ? nodeOptions : `${nodeOptions} ${preloadOption}`;
      options.envPairs = [...pairs, `TOCYN_REHEARSAL_PROCESS_REGISTRY=${childScope}`, `TOCYN_REHEARSAL_ANCESTOR_REGISTRIES=${JSON.stringify(scopes.filter(scope => scope !== childScope))}`, `NODE_OPTIONS=${inheritedOptions}`];
      const result = original.call(this, options);
      if (this.pid) for (const scope of scopes) registry.register(scope, this.pid);
      return result;
    } catch (error) {
      if (!closed(scopes) || this.pid) for (const scope of scopes) registry.markFailed(scope);
      throw error;
    } finally { for (const lock of locks) fs.rmSync(lock, { force: true }); }
  };
  syncBuiltinESMExports();
}
