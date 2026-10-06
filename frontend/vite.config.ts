import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const backendPort = process.env.BACKEND_PORT ?? '3005';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5180,
    strictPort: false,
    fs: { allow: [repoRoot] },
    proxy: {
      '/ws': { target: `ws://localhost:${backendPort}`, ws: true },
      '/health': { target: `http://localhost:${backendPort}` },
      '/api': { target: `http://localhost:${backendPort}` },
    },
  },
  preview: { port: 5180 },
  build: { target: 'es2022', sourcemap: false },
});
