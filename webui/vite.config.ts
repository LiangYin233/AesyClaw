import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      hmr: {
        host: 'localhost',
        port: 5173,
        overlay: true,
      },
      watch: {
        usePolling: true,
        interval: 300,
      },
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:18792',
          changeOrigin: true,
        },
      },
    },
  };
});
