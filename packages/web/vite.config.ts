import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vite';

const API = `http://127.0.0.1:${process.env.AI_OFFICE_PORT ?? 4848}`;

/** The server's access token (`<state dir>/token`), read on every request so a restart or a new token just works. */
function readToken(): string | undefined {
  const dir = process.env.AI_OFFICE_STATE_DIR ?? join(process.env.HOME ?? homedir(), '.ai-office');
  try {
    return readFileSync(join(dir, 'token'), 'utf8').trim();
  } catch {
    return undefined;
  }
}

// Dev proxy. The server only trusts its own Host/Origin and wants the access token, so the proxy (running in Node, as
// the same user as the server) presents itself as the server's own page: Host and Origin of the API, plus
// `Authorization: Bearer <token>`. The token never reaches the browser in dev. (In production the server sets the
// session cookie when it serves index.html.)
export default defineConfig({
  base: '/',
  build: { outDir: 'dist', assetsDir: 'assets', sourcemap: true, target: 'es2022' },
  resolve: {
    // transformers.js imports the WebGPU build of ONNX Runtime Web, which drags in a 27 MB WebAssembly file nothing uses:
    // voice input runs on the plain WebAssembly backend (14 MB), which is the same API without WebGPU.
    alias: { 'onnxruntime-web/webgpu': 'onnxruntime-web/wasm' },
  },
  // The speech worker (transformers.js) is a module worker with its own chunks; nothing of it is in the main bundle.
  worker: { format: 'es' },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            if (proxyReq.getHeader('origin') !== undefined) proxyReq.setHeader('origin', API);
            const token = readToken();
            if (token !== undefined && token !== '') proxyReq.setHeader('authorization', `Bearer ${token}`);
          });
        },
      },
    },
  },
});
