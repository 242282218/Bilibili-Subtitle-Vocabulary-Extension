import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "react-ui");

export default defineConfig({
  root,
  base: "./",
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        options: resolve(root, "options.html"),
        popup: resolve(root, "popup.html")
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-chunk.js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});
