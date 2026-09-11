/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Multi-pass production minification retains supported syntax and language grammars.
    minify: 'terser',
    terserOptions: { compress: { passes: 5 } },
    rolldownOptions: {
      output: {
                // Content-hashed names avoid repeating long source names in every import.
                // The manifest retains source-to-asset mapping; lazy route boundaries stay intact.
                entryFileNames: 'assets/[hash:6].js',
                chunkFileNames: 'assets/[hash:6].js',
        // Share icons and workspace data hooks rather than repeating compressed import wrappers.
        // Route components stay lazy; CI checks initial and total transfer plus browser timings.
        manualChunks: id => id.includes('lucide-react') ? 'lucide-icons' : /apps\/dashboard\/src\/hooks\//.test(id) ? 'workspace-hooks' : undefined,
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    globals: true,
  },
})
