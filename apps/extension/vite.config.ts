import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, "src/content/main.ts"),
        background: resolve(__dirname, "src/background/main.ts"),
      },
      output: { entryFileNames: "[name].js" },
    },
  },
});
