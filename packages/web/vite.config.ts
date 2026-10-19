import { defineConfig } from 'vite';

const API = `http://127.0.0.1:${process.env.AI_OFFICE_PORT ?? 4848}`;

export default defineConfig({
  base: '/',
  build: { outDir: 'dist', assetsDir: 'assets', sourcemap: true, target: 'es2022' },
  server: { port: 5173, proxy: { '/api': { target: API, changeOrigin: false } } },
});
