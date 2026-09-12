import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Serve the repo's MEI corpus at / during dev (fetch("/Bach-….mei")).
  // Production builds skip it: the corpus is ~13MB and would otherwise be
  // embedded verbatim inside the shell binary.
  publicDir: command === "build" ? false : resolve(__dirname, "../../fixtures"),
  server: {
    fs: { allow: [resolve(__dirname, "../..")] },
  },
  // Never prebundle the workspace packages: a running dev server must pick
  // up `npm run build -w @battuta/core` (or the api) without a restart.
  optimizeDeps: { exclude: ["@battuta/core", "@battuta/api"] },
  build: {
    // .vite/manifest.json is what scripts/check-budget.mjs reads: the
    // initial chunk (the HTML entry's static closure) must stay under
    // budget.json, and must not reach any plugin chunk statically.
    manifest: true,
    rollupOptions: {
      output: {
        // Every plugin's code becomes its own `plugin-<name>` chunk, so a
        // plugin leaking into the initial chunk is visible by name.
        manualChunks(id) {
          const m = /packages\/plugins\/([^/]+)\//.exec(id.replace(/\\/g, "/"));
          return m ? `plugin-${m[1]}` : undefined;
        },
      },
    },
  },
}));
