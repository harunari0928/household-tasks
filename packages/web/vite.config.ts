import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiPort = process.env.API_PORT || '3100';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: '.',
  build: {
    outDir: 'dist/client',
  },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
        // リアルタイム同期の WebSocket（/api/kanban/ws）も同じ prefix なので中継する
        ws: true,
      },
    },
  },
});
