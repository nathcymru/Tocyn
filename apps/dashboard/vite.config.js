import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    build: {
        rolldownOptions: {
            output: {
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
