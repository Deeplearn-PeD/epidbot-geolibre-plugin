import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// GeoLibre external-plugin bundle: one self-contained ES module plus a CSS
// file, laid out to match geolibre-plugin/plugin.json (entry dist/index.js,
// style dist/style.css). Kept unminified on purpose: registry plugins are
// trusted code reviewed by hand, so the readable bundle is part of the deal.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/geolibre.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: "geolibre-plugin/dist",
    emptyOutDir: true,
    rollupOptions: {
      external: [],
      output: {
        assetFileNames: () => "style.css",
      },
    },
    cssCodeSplit: false,
    sourcemap: false,
    minify: false,
  },
});
