import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background/main.ts"),
        options: resolve(__dirname, "src/options/main.ts"),
      },
      output: { entryFileNames: "[name].js" },
    },
  },
});