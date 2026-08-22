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
  server: { port: 0 },
  logLevel: "warn",
});
await server.listen();

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(server.resolvedUrls.local[0] + "?pool=2");
try {

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

// --- 2b. context editing: clef / key / meter dropdowns at the caret ---
const ctxAt = (m, n) => page.evaluate(({ m, n }) => {
  const c = window.__SESSION__.contexts[m].get(n);
  return { keysig: c.keysig, clef: c.clef, meter: c.meter };
}, { m, n });
// key change at m4 (score-wide from there on)
await page.locator('.tile[data-index="3"] g[class~="note"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.focus('select[title*="key signature"]');
await page.selectOption('select[title*="key signature"]', "2f");
await page.waitForFunction(() => window.__SESSION__.contexts[3].get(1).keysig === "2f", null, { timeout: 10000 });
check("key dropdown changes the key at the caret measure", (await ctxAt(3, 1)).keysig === "2f");
check("dropdown releases focus back to the editor", await page.evaluate(() => document.activeElement?.tagName !== "SELECT"));
const caretBeforeArrow = await page.evaluate(() => document.querySelector("main").dataset.caret);
await page.keyboard.press("ArrowRight");
await page.waitForFunction((prev) => document.querySelector("main").dataset.caret !== prev, caretBeforeArrow, { timeout: 5000 });
check("arrows move the caret after a dropdown apply (no re-fire)", await page.evaluate(() => window.__SESSION__.stack.undoDepth === 1));
await page.keyboard.press("ArrowLeft");
await page.waitForFunction((prev) => document.querySelector("main").dataset.caret === prev, caretBeforeArrow, { timeout: 5000 });
check("key change propagates downstream", (await ctxAt(5, 1)).keysig === "2f");
check("earlier measures keep their key", (await ctxAt(2, 1)).keysig === "4s");
await page.waitForFunction(() => {
  const t = document.querySelector('.tile[data-index="3"]');
  return t && ((t.innerHTML.match(/E260/g) ?? []).length >= 2); // flat glyphs drawn
}, null, { timeout: 15000 });
check("the tile shows the new flats (context-change header policy)", true);
// clef change, staff-local
await page.locator('.tile[data-index="1"] g[class~="note"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
const clefStaff = await page.evaluate(() => window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret)?.staffN);
const otherStaff = clefStaff === 1 ? 2 : 1;
const otherClefBefore = JSON.stringify((await ctxAt(1, otherStaff)).clef);
await page.selectOption('select[title*="clef"]', "C3");
await page.waitForFunction((n) => {
  const c = window.__SESSION__.contexts[1].get(n)?.clef;
  return c && c.shape === "C" && c.line === 3;
}, clefStaff, { timeout: 10000 });
const otherClefAfter = JSON.stringify((await ctxAt(1, otherStaff)).clef);
check(`clef change is staff-local (staff ${clefStaff} -> C3, staff ${otherStaff} unchanged)`, otherClefAfter === otherClefBefore);
// meter: refused on full measures, allowed on an empty one
await page.locator('.tile[data-index="0"] g[class~="note"] use').first().click({ force: true });
await page.selectOption('select[title*="meter"]', "3/4");
await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("refused"), null, { timeout: 5000 });
check("meter change refuses when content no longer fits", true);
await page.keyboard.press("NumpadAdd"); // caret lands in the new empty measure
await page.waitForFunction(() => window.__SESSION__.score.measures.length === 11, null, { timeout: 10000 });
await page.selectOption('select[title*="meter"]', "3/4");
await page.waitForFunction(() => {
  const i = window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret)?.measureIndex;
  const c = i !== undefined && window.__SESSION__.contexts[i]?.get(1)?.meter;
  return c && c.count === "3" && c.unit === "4";
}, null, { timeout: 10000 });
check("meter change succeeds on an empty measure", true);
// unwind everything from this block
for (let i = 0; i < 4; i++) await page.keyboard.press("Control+z");
await page.waitForFunction(() => window.__SESSION__.stack.undoDepth === 0 && window.__SESSION__.contexts[3].get(1).keysig === "4s", null, { timeout: 10000 });
check("undo chain restores all context changes", true);

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

} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
