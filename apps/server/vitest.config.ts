import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Node unit tests cannot load Cloudflare's runtime-only module.
      'cloudflare:workers': fileURLToPath(new URL('./src/test-support/cloudflare-workers.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
  },
});
