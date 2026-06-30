import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false,
    cssCodeSplit: false,
    minify: "esbuild",
    lib: {
      entry: resolve(__dirname, "react-ui/src/components/overlay-entry.tsx"),
      formats: ["es"],
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
