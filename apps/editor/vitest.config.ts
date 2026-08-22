import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // the key model is pure — no DOM needed
    include: ["test/**/*.test.ts"],
  },
});
