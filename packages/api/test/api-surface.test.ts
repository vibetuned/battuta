/**
 * The public surface is versioned and diffed: a change to any exported
 * type must come with a version bump and a regenerated api-report.d.ts.
 * Generated from the sources through the compiler API, so a stale dist/
 * cannot mask a change.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { publicSurface, packageVersion, reportPath, renderReport, parseReport } from "../scripts/surface.mjs";
import { API_VERSION } from "../src/index";

describe("@battuta/api public surface", () => {
  it("matches api-report.d.ts — bump the version and run `npm run api:update -w @battuta/api` when it changes", () => {
    const committed = readFileSync(reportPath, "utf8");
    expect(renderReport(packageVersion(), publicSurface())).toBe(committed);
  });

  it("carries one version number: package.json, API_VERSION and the report header agree", () => {
    const committed = readFileSync(reportPath, "utf8");
    expect(API_VERSION).toBe(packageVersion());
    expect(parseReport(committed).version).toBe(packageVersion());
  });
});
