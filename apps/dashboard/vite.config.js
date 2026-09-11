import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    build: {
        rolldownOptions: {
            output: {
                // Content-hashed names avoid repeating long source names in every import.
                // The manifest retains source-to-asset mapping; lazy route boundaries stay intact.
                entryFileNames: 'assets/[hash:6].js',
                chunkFileNames: 'assets/[hash:6].js',
                // Keep shared icons together instead of emitting each one as a separately gzipped asset.
                manualChunks: (id) => id.includes('lucide-react') ? 'lucide-icons' : undefined,
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
