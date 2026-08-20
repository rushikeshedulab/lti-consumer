import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:4001',
      '/lti': 'http://localhost:4001',
      '/.well-known': 'http://localhost:4001',
    },
  },
});
