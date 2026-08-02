import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  // Serve the repo's MEI corpus at / during dev (fetch("/Bach-….mei")).
  publicDir: resolve(__dirname, "../../fixtures"),
  server: {
    fs: { allow: [resolve(__dirname, "../..")] },
  },
  // Never prebundle the workspace core: a running dev server must pick up
  // `npm run build -w @battuta/core` without a restart/cache clear.
  optimizeDeps: { exclude: ["@battuta/core"] },
});
