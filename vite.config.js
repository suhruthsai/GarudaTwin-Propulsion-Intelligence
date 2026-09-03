import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    watch: {
      ignored: ['**/ai_venv/**']
    },
    proxy: {
      '/socket.io': {
        target: 'http://localhost:5002',
        ws: true,
        changeOrigin: true
      },
      '/api': {
        target: 'http://localhost:5002',
        changeOrigin: true
      },
      '/ai': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ai/, '')
      }
    }
  }
});
