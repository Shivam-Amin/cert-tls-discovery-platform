import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: `npm run dev` serves the UI on :5173 and forwards /api to the backend.
// Prod: `npm run build` writes dist/, which the backend serves on :8080.
export default defineConfig({
  plugins: [react()],
  // One ~350 KB (gzip) bundle is fine for a local app; no need to split it.
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
});
