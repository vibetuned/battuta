/**
 * Run every plugin package's vitest suite, one after the other, from the
 * repo root: `npm run test:plugins`. A plugin has no vitest config of its
 * own (a config file would be an import the boundary test forbids), so
 * vitest is pointed at each package with --root and finds test/**.
 * Cross-platform on purpose — CI is Linux, contributors are not always.
 */
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const plugins = readdirSync(here).filter((d) => existsSync(join(here, d, "package.json")));
if (plugins.length === 0) {
  console.log("no plugin packages under packages/plugins — nothing to test");
  process.exit(0);
}
let failed = 0;
for (const name of plugins) {
  console.log(`\n=== @battuta/plugin-${name} ===`);
  const r = spawnSync("npx", ["vitest", "run", "--root", join(here, name)], { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
