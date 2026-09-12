/**
 * `prepare` for @battuta/api. The api's declarations import types from
 * @battuta/core, which resolves to core's dist/ — and on a fresh clone
 * (`npm ci`, CI, a new machine) npm may run this package's prepare BEFORE
 * core's, so the types are not there yet. Build core first when its dist
 * is missing, then emit ours. Idempotent: with core already built this
 * is just `tsc -p tsconfig.build.json`.
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const api = join(here, "..");
const core = join(api, "..", "core");

if (!existsSync(join(core, "dist", "index.d.ts"))) {
  console.log("@battuta/api prepare: @battuta/core has no dist yet — building it first");
  execSync("npm run build", { cwd: core, stdio: "inherit" });
}
execSync("npx tsc -p tsconfig.build.json", { cwd: api, stdio: "inherit" });
