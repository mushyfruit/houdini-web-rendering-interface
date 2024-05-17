import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'project/src',
  build: {
    outDir: '../../project/app/static/dist', // Correct placement of outDir
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'project/src/main.js')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  }
});