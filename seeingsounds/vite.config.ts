import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Set by `tauri ios dev` / `tauri android dev` so a physical device can reach
// the dev server over the local network.
const tauriDevHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keep Rust compiler output visible when running under `tauri dev`.
  clearScreen: false,
  server: {
    host: tauriDevHost || '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    hmr: tauriDevHost ? { protocol: 'ws', host: tauriDevHost, port: 3001 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  worker: { format: 'es' },
  build: {
    // WKWebView on iOS 15+ and WebView2/WebKitGTK all support ES2021.
    target: 'es2021',
  },
});
