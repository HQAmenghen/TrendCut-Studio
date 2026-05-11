import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  root: path.resolve('frontend'),
  plugins: [vue()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/output_final.mp4': 'http://127.0.0.1:3001',
      '/standalone_output_vertical.mp4': 'http://127.0.0.1:3001',
      '/xai_vertical_queue': 'http://127.0.0.1:3001',
      '/presets': 'http://127.0.0.1:3001'
    }
  },
  build: {
    outDir: path.resolve('frontend-dist'),
    emptyOutDir: true
  }
});
