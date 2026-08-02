/**
 * Drive the browser bench headlessly: vite dev server + Playwright + Chrome.
 * Writes spikes/out/browser-results.json.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { makeSlices } from "../lib/make-slices.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
makeSlices();

const server = await createServer({
  configFile: false,
  root: here,
  publicDir: join(here, "../out/slices"),
  server: { port: 5199, strictPort: false, fs: { allow: [repoRoot] } },
  logLevel: "warn",
});
await server.listen();
const url = server.resolvedUrls.local[0];
console.log("serving", url);

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const page = await browser.newPage();
page.on("console", (m) => console.log("  [page]", m.text()));
page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
await page.goto(url);
await page.waitForFunction(() => window.__RESULTS__ !== undefined, null, { timeout: 300000 });
const results = await page.evaluate(() => window.__RESULTS__);

writeFileSync(join(here, "../out/browser-results.json"), JSON.stringify(results, null, 2));
console.log("wrote spikes/out/browser-results.json");
if (results.error) {
  console.error("bench reported error:", results.error);
  process.exitCode = 1;
}
await browser.close();
await server.close();
