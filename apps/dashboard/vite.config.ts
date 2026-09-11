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
        // Keep the static application closure separate from lazy administration routes.
        // Native group priority preserves route laziness while sharing its compressed wrappers.
        codeSplitting: {
          groups: [
            { name: 'entry-closure', test: /\/apps\/dashboard\/src\/main\.tsx$/, priority: 100 },
            { name: 'lucide-icons', test: /lucide-react/, priority: 10 },
            { name: 'workspace-hooks', test: /apps\/dashboard\/src\/hooks\//, priority: 10 },
            { name: 'administration-routes', test: /\/apps\/dashboard\/src\/pages\/(?:ApiKey|AgentPermissions|FiltersSettings|Groups|Settings|SupportStates|TicketFields|Users)Page\.tsx$/, priority: 0 },
          ],
        },
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
