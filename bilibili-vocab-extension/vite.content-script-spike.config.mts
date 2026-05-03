import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: resolve(__dirname, 'dist-spike'),
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, 'contentScriptBundleSpike.entry.mjs'),
      formats: ['iife'],
      name: 'BiliVocabContentScriptBundleSpike',
      fileName: () => 'content-script.bundle.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
