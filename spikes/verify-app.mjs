/**
 * Headless end-to-end check of the editor app (Vite dev + Playwright/Chrome):
 *  1. context fixture: tile after the key change visibly carries 4 sharps
 *  2. click a notehead -> id-based selection works
 *  3. 313-measure quartet: virtualized scroll renders tiles at the far end
 *  4. page view toggle streams full Verovio pages
 * Run: node spikes/verify-app.mjs
 */
import { createServer } from "vite";
import { chromium } from "playwright";

const scratch = process.env.SCRATCH ?? "/tmp/claude-1000/-home-flux-projects-battuta/6232b880-dd50-4f19-a593-9bf21de90cbb/scratchpad";
let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

const server = await createServer({
  configFile: "/home/flux/projects/battuta/apps/editor/vite.config.ts",
  root: "/home/flux/projects/battuta/apps/editor",
  server: { port: 5177, strictPort: true },
  logLevel: "warn",
});
await server.listen();

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto("http://localhost:5177/");

// --- 1. Context fixture (default): all 10 tiles render, m3+ carry sharps ---
// NB: count .ms labels, not "svg" elements — Verovio nests an inner <svg>,
// so a raw svg count double-counts and passes before all tiles are rendered.
await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 10, null, { timeout: 60000 });
const sharpsPerTile = await page.evaluate(() =>
  [...document.querySelectorAll(".tile")].map((t) => t.innerHTML.match(/E262/g)?.length ?? 0),
);
check("m1-m2 tiles show no key-signature sharps", sharpsPerTile[0] === 0 && sharpsPerTile[1] === 0);
check("m3 (context change) shows the new key signature", sharpsPerTile[2] >= 8);
check("m4 is bare: keysig hidden but still in force", sharpsPerTile[3] === 0);
const meterTile = await page.evaluate(() => document.querySelectorAll(".tile")[6].innerHTML);
check("m7 tile reflects 6/8 meter change", meterTile.includes("meterSig"));
const curveTiles = await page.evaluate(() => [0, 1].map((i) => {
  const html = document.querySelectorAll(".tile")[i].innerHTML;
  return { slur: html.includes('class="slur'), tie: html.includes('class="tie') };
}));
check("cross-tile slur+tie continuations drawn in both m1 and m2", curveTiles.every((t) => t.slur && t.tie));

// --- 2. Click places the caret via ids ---
await page.locator('.tile g[class~="note"] use').first().click({ force: true });
const caretIdVal = await page.evaluate(() => document.querySelector("main").dataset.caret);
check(`notehead click places the caret (${caretIdVal})`, !!caretIdVal);
await page.screenshot({ path: `${scratch}/app-context-fixture.png` });

// --- 3. Quartet: virtualized scroll to the end ---
await page.selectOption("select", "Beethoven_StringQuartet_Op18_No1.mei");
await page.waitForFunction(() => document.querySelectorAll(".tile").length > 300, null, { timeout: 60000 });
const t0 = Date.now();
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForFunction(() => {
  const tiles = [...document.querySelectorAll(".tile")];
  return tiles.slice(-5).every((t) => t.querySelector("svg"));
}, null, { timeout: 60000 });
check(`quartet: last tiles rendered after scroll-to-end (${Date.now() - t0} ms)`, true);
const statusText = await page.locator("header span").first().textContent();
console.log("  status:", statusText);
await page.screenshot({ path: `${scratch}/app-quartet-end.png` });

// --- 4. Page view ---
await page.selectOption("select", "Bach-JS_Ein_feste_Burg.mei");
await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 14, null, { timeout: 60000 });
await page.getByRole("button", { name: "page view" }).click();
await page.waitForFunction(() => document.querySelectorAll(".pages .page svg").length >= 1, null, { timeout: 60000 });
check("page view renders full Verovio pages", true);
await page.screenshot({ path: `${scratch}/app-page-view.png` });

await browser.close();
await server.close();
process.exit(failures ? 1 : 0);
