/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
                // Content-hashed names avoid repeating long source names in every import.
                // The manifest retains source-to-asset mapping; lazy route boundaries stay intact.
                entryFileNames: 'assets/[hash:6].js',
                chunkFileNames: 'assets/[hash:6].js',
        // Rolldown otherwise emits each shared Lucide icon as a separately gzipped asset.
        // Keep the icon module family together so the production artifact avoids that
        // per-asset compression overhead while retaining route-level code splitting.
        manualChunks: id => id.includes('lucide-react') ? 'lucide-icons' : undefined,
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
