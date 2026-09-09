// Test teardown only: disappearance after identity inspection is already-clean state.
export function killIfPresent(pid, signalProcess = process.kill) {
  try { signalProcess(pid, 'SIGKILL'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
