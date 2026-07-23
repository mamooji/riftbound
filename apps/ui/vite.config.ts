import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The workspace packages (engine/cards/shared) are TypeScript *source*, imported with NodeNext-style
 * ".js" specifiers that actually point at ".ts" files. Vite's resolver looks for the literal ".js"
 * on disk, so rewrite those relative ".js" imports to the real ".ts" file when one exists.
 */
function workspaceJsToTs(): Plugin {
  return {
    name: "workspace-js-to-ts",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !source.startsWith(".") || !source.endsWith(".js")) return null;
      const tsPath = path.resolve(path.dirname(importer), source).replace(/\.js$/, ".ts");
      return existsSync(tsPath) ? tsPath : null;
    },
  };
}

export default defineConfig({
  plugins: [workspaceJsToTs(), react()],
  server: { port: 5199, host: "127.0.0.1" },
  // The engine/cards sources change constantly during testing — keep them as live source rather
  // than pre-bundled deps so edits hot-reload.
  optimizeDeps: { exclude: ["@riftbound/engine", "@riftbound/cards", "@riftbound/shared"] },
});
