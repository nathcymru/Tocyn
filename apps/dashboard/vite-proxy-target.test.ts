import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveApiProxyTarget, resolveApiProxyTargetForMode } from './vite-proxy-target';

describe('dashboard API proxy target', () => {
  it('keeps the ordinary development target when no isolated review is requested', () => {
    expect(resolveApiProxyTarget({})).toBe('http://localhost:8787');
  });

  it('routes an isolated snooze review to its own loopback API port', () => {
    expect(resolveApiProxyTarget({ TOCYN_SNOOZE_REVIEW_API_PORT: '8790' })).toBe('http://127.0.0.1:8790');
  });

  it('refuses a default-port fallback or a direct API URL that bypasses the review proxy', () => {
    expect(() => resolveApiProxyTarget({ TOCYN_SNOOZE_REVIEW_API_PORT: '8787' })).toThrow();
    expect(() => resolveApiProxyTarget({ TOCYN_SNOOZE_REVIEW_API_PORT: '5176' })).toThrow();
    expect(() => resolveApiProxyTarget({ TOCYN_SNOOZE_REVIEW_API_PORT: 'localhost:8790' })).toThrow();
    expect(() => resolveApiProxyTarget({ TOCYN_SNOOZE_REVIEW_API_PORT: '8790', VITE_API_URL: 'http://127.0.0.1:8787' })).toThrow();
  });

  it('rejects a direct API URL loaded from a Vite env file', () => {
    const envDir = mkdtempSync(join(tmpdir(), 'tocyn-snooze-vite-env-'));
    try {
      writeFileSync(join(envDir, '.env.development'), 'VITE_API_URL=http://127.0.0.1:8787\n');
      expect(() => resolveApiProxyTargetForMode('development', envDir,
        { TOCYN_SNOOZE_REVIEW_API_PORT: '8790' })).toThrow(/VITE_API_URL/);
    } finally {
      rmSync(envDir, { recursive: true, force: true });
    }
  });
});
