// Builds the dashboard into dist/ (served by the daemon under /dash/). `pnpm --filter @israel-tv/dashboard dev`
// serves it with hot reload and sends /api to a running daemon (DASHBOARD_API, default http://127.0.0.1:7702).
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/dash/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
    modulePreload: { polyfill: false },
    // No inline scripts or data: modules: the page's CSP allows scripts from itself only.
    assetsInlineLimit: 0,
    target: 'es2023',
  },
  server: {
    proxy: { '/api': process.env.DASHBOARD_API ?? 'http://127.0.0.1:7702' },
  },
});
