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
        // plugin leaking into the initial chunk is visible by name. Three
        // things are in the host's initial closure BY DESIGN and get one
        // named `battuta-shared` chunk: core, the api, and every plugin's
        // manifest (imported statically so bindings exist before the code
        // loads). Naming them matters twice over: Rollup would otherwise
        // settle core inside the first plugin chunk that imports it, and
        // it folds a tiny unassigned manifest module into its neighbour's
        // chunk — `undefined` here means "no opinion", not "keep it out".
        manualChunks(id) {
          const f = id.replace(/\\/g, "/");
          const plugin = /packages\/plugins\/([^/]+)\/(.*)$/.exec(f);
          if (plugin) return /(^|\/)manifest\.(ts|js|mjs)$/.test(plugin[2]) ? "battuta-shared" : `plugin-${plugin[1]}`;
          if (/\/packages\/(core|api)\//.test(f)) return "battuta-shared";
          // React is imported by the host AND by any plugin that renders a
          // panel. Unnamed, Rollup settles it inside the FIRST plugin chunk
          // that imports it, and the host then has to import that chunk
          // statically to get React — which the budget check reports as
          // "plugin code reached from the initial chunk". Same failure as
          // core in slice 2 and react in slice 4's first attempt: anything
          // the host and a plugin share must be named.
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(f)) return "battuta-shared";
          return undefined;
        },
      },
    },
  },
}));
