import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: path.resolve(__dirname, '../extension/dist/webview'),
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: 'main.js', assetFileNames: '[name][extname]' },
    },
  },
  resolve: {
    alias: { '@shared': path.resolve(__dirname, '../shared/src') },
  },
});
