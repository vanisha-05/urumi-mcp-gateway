import { defineConfig } from 'vite';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const gatewayOrigin = env.VITE_GATEWAY_ORIGIN || 'http://localhost';
  // Dashboard is mounted under /dashboard locally and at / on its prod host.
  return {
    base: './',
    plugins: [react()],
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy: Object.fromEntries(['/api', '/admin', '/user', '/auth', '/mcp'].map(path => [path, {
        target: gatewayOrigin,
        changeOrigin: true,
      }])),
    },
  };
});
