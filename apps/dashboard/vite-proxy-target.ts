import { loadEnv } from 'vite';

/** The isolated snooze review uses its own dashboard port and must never proxy
 * to the ordinary 8787 fixture or bypass this proxy with a direct API URL. */
export function resolveApiProxyTarget(env: Readonly<Record<string, string | undefined>>): string {
  const port = env.TOCYN_SNOOZE_REVIEW_API_PORT;
  if (port === undefined) return 'http://localhost:8787';
  if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535 || [5176, 8787].includes(Number(port))) {
    throw new Error('TOCYN_SNOOZE_REVIEW_API_PORT must be an isolated port from 1024 to 65535, excluding 5176 and 8787');
  }
  if (env.VITE_API_URL) throw new Error('Unset VITE_API_URL for the isolated snooze review dashboard');
  return `http://127.0.0.1:${port}`;
}

/** Vite reads .env files after loading its config. Check the same files here so
 * a file-provided VITE_API_URL cannot silently bypass the review proxy. */
export function resolveApiProxyTargetForMode(mode: string, envDir: string,
  processEnv: Readonly<Record<string, string | undefined>>): string {
  const viteEnv = loadEnv(mode, envDir, 'VITE_');
  return resolveApiProxyTarget({
    TOCYN_SNOOZE_REVIEW_API_PORT: processEnv.TOCYN_SNOOZE_REVIEW_API_PORT,
    VITE_API_URL: processEnv.VITE_API_URL || viteEnv.VITE_API_URL,
  });
}
