import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Configures the Vite dev server and build, proxying /api requests to the local API with X-Forwarded-For.
 * @since REQ-001
 * @updated REQ-005
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        xfwd: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
