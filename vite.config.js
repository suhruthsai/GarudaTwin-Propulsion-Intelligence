import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Pages served by this dev server (localhost or its Network URL) reach the gateway through
// the proxy. The gateway only accepts allow-listed browser origins, so proxied requests are
// presented with the GCS origin; foreign web pages calling :5002 directly are still refused.
const GCS_ORIGIN = 'http://localhost:5173';
const asGcsOrigin = (proxy) => {
  proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('origin', GCS_ORIGIN));
  proxy.on('proxyReqWs', (proxyReq) => proxyReq.setHeader('origin', GCS_ORIGIN));
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // fail loudly instead of moving to 5174 (which the gateway would not allow)
    host: true,
    watch: {
      ignored: ['**/ai_venv/**', '**/training/data/**']
    },
    proxy: {
      '/socket.io': {
        target: 'http://localhost:5002',
        ws: true,
        changeOrigin: true,
        configure: asGcsOrigin
      },
      '/api': {
        target: 'http://localhost:5002',
        changeOrigin: true,
        configure: asGcsOrigin
      }
      // No proxy to the AI service (:8001): browsers reach it only through the gateway
    }
  }
});
