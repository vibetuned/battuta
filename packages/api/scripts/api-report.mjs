/**
 * Check or regenerate api-report.d.ts, the committed snapshot of the
 * public surface. Without --update it only reports drift (exit 1). With
 * --update it rewrites the report — but refuses when the surface changed
 * and package.json still carries the version the old report was made
 * for: plugins pin `engines.battuta` against that number.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { publicSurface, packageVersion, reportPath, renderReport, parseReport } from "./surface.mjs";

const update = process.argv.includes("--update");
const version = packageVersion();
const surface = publicSurface();
const next = renderReport(version, surface);
const current = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : null;

if (current === next) {
  console.log(`api-report.d.ts is current (@battuta/api ${version})`);
  process.exit(0);
}
if (!update) {
  console.error("api-report.d.ts is stale: the public surface (or the version) changed.");
  console.error("Bump \"version\" in packages/api/package.json, then run: npm run api:update -w @battuta/api");
  process.exit(1);
}
if (current !== null) {
  const old = parseReport(current);
  if (old.version === version && old.body !== surface) {
    console.error(`the public surface changed but package.json is still ${version}.`);
    console.error("The api's surface is the user's: a slice may add only what its brief lists, and a change the user approved gets a version bump");
    console.error("(a patch bump while the number is unpublished) before this report is rewritten. If nobody approved it, revert the change.");
    process.exit(1);
  }
}
writeFileSync(reportPath, next);
console.log(`api-report.d.ts written for @battuta/api ${version}`);
