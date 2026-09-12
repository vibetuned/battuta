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
    console.error(`the public surface changed but package.json is still ${version} — bump the version first (plugins pin engines.battuta against it)`);
    process.exit(1);
  }
}
writeFileSync(reportPath, next);
console.log(`api-report.d.ts written for @battuta/api ${version}`);
