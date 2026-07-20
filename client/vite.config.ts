/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['Chrome >= 49', 'Safari >= 10', 'Firefox >= 31', 'Edge >= 15', 'Samsung >= 5', 'not IE 11'],
      renderLegacyChunks: true,
    }),
  ],
  resolve: {
    alias: {
      '@camtom/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    manifest: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'index.html'),
        display: path.resolve(__dirname, 'display/index.html'),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: true,
  },
});
