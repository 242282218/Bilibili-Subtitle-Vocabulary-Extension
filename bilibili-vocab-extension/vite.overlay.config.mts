import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, "react-ui/src/overlay-entry.tsx"),
      name: "BiliVocabOverlay",
      formats: ["iife"],
      fileName: () => "overlay.js"
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});
