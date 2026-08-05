import { defineConfig } from "vitest/config";

// Keep the thread pool small: the default (one thread per core) spawns 24
// workers on big machines and, together with e2e Chrome + the dev server,
// has exhausted the box. Two threads lose almost no wall-clock here.
export default defineConfig({
  test: {
    poolOptions: { threads: { maxThreads: 2, minThreads: 1 } },
  },
});
