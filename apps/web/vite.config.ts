import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Our workspace packages ship raw TypeScript (the "just-in-time packages" pattern). Excluding
  // them from dep pre-bundling makes Vite transform their .ts through its normal esbuild
  // pipeline, so edits in the engine hot-reload in the app.
  optimizeDeps: {
    exclude: [
      "@riftbound/engine",
      "@riftbound/bot",
      "@riftbound/cards",
      "@riftbound/shared",
    ],
  },
});
