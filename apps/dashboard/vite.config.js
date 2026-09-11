import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    build: {
        minify: 'terser',
        terserOptions: { compress: { passes: 5 } },
        rolldownOptions: {
            output: {
                // Content-hashed names avoid repeating long source names in every import.
                // The manifest retains source-to-asset mapping; lazy route boundaries stay intact.
                entryFileNames: 'assets/[hash:6].js',
                chunkFileNames: 'assets/[hash:6].js',
                // Share icons and workspace data hooks to avoid many separately compressed import wrappers.
                // Route components remain lazy; initial and all-client transfer limits are checked in CI.
                manualChunks: (id) => id.includes('lucide-react') ? 'lucide-icons' : /apps\/dashboard\/src\/hooks\//.test(id) ? 'workspace-hooks' : undefined,
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
});
