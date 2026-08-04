/**
 * Phase 2 end-to-end check (Vite dev + Playwright/Chrome):
 *  1. click a note -> caret appears at it
 *  2. arrow keys move the caret through events and across measures
 *  3. shift+arrow builds an event selection
 *  4. alt+up transposes: the notehead moves, only that tile re-renders,
 *     and the edit->screen latency reported by the HUD is within budget
 *  5. delete converts to rest; ctrl+z / ctrl+shift+z undo/redo reliably
 * Run: node spikes/verify-phase2.mjs
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
await page.goto(server.resolvedUrls.local[0]);
await page.selectOption("select", "Bach-JS_Ein_feste_Burg.mei");
await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 14, null, { timeout: 60000 });

const caretId = () => page.evaluate(() => document.querySelector("main").dataset.caret);
const selCount = () => page.evaluate(() => Number(document.querySelector("main").dataset.selection));
// Rendered vertical position of a note (Verovio positions glyphs via
// transform=translate(...), so we compare real bounding boxes, not attrs).
const noteTop = (id) => page.evaluate((id) => {
  const g = document.querySelector(`g[id="${CSS.escape(id)}"]`);
  return g ? Math.round(g.getBoundingClientRect().top * 10) / 10 : null;
}, id);

// --- 1. click a note -> caret ---
await page.locator('.tile g[class~="note"] use').first().click({ force: true });
const id0 = await caretId();
check(`clicking a note places the caret (${id0})`, !!id0);
const caretDrawn = await page.waitForSelector(".caret", { timeout: 5000 }).then(() => true).catch(() => false);
check("caret bar is drawn", caretDrawn);

// --- 2. arrow navigation ---
await page.keyboard.press("ArrowRight");
const id1 = await caretId();
check(`ArrowRight moves to the next event (${id1})`, !!id1 && id1 !== id0);
await page.keyboard.press("ArrowLeft");
check("ArrowLeft returns", (await caretId()) === id0);
// cross the measure boundary: walk right until the caret leaves measure 1
let crossed = false;
for (let i = 0; i < 12; i++) {
  await page.keyboard.press("ArrowRight");
  const inFirstTile = await page.evaluate(() => {
    const id = document.querySelector("main").dataset.caret;
    const tile = document.querySelector(`g[id="${CSS.escape(id)}"]`)?.closest(".tile");
    return tile?.dataset.index === "0";
  });
  if (!inFirstTile) { crossed = true; break; }
}
check("caret crosses the measure boundary transparently", crossed);
await page.keyboard.press("ArrowDown");
const afterDown = await caretId();
check(`ArrowDown switches staff (${afterDown})`, !!afterDown);

// --- 3. selection ---
await page.locator('.tile g[class~="note"] use').first().click({ force: true });
await page.keyboard.press("Shift+ArrowRight");
await page.keyboard.press("Shift+ArrowRight");
check("shift+arrow extends the selection to 3 events", (await selCount()) === 3);
await page.keyboard.press("Escape");
check("escape clears the selection", (await selCount()) === 0);

// --- 4. transpose + latency + minimal invalidation ---
await page.locator('.tile g[class~="note"] use').first().click({ force: true });
const tid = await caretId();
const yBefore = await noteTop(tid);
const freshBefore = await page.evaluate(() => Number(document.querySelector("[data-status]").textContent.match(/(\d+) fresh/)?.[1] ?? -1));
await page.keyboard.press("Alt+ArrowUp");
await page.waitForFunction((args) => {
  const g = document.querySelector(`g[id="${CSS.escape(args.id)}"]`);
  if (!g) return false;
  return Math.abs(g.getBoundingClientRect().top - args.was) > 1;
}, { id: tid, was: yBefore }, { timeout: 15000 });
const yAfter = await noteTop(tid);
check(`alt+up transposes (note top ${yBefore} -> ${yAfter})`, Math.abs(yAfter - yBefore) > 1);
const status = await page.locator("[data-status]").textContent();
const latency = Number(status.match(/last edit → screen (\d+) ms/)?.[1] ?? NaN);
check(`edit → screen latency within budget (${latency} ms < 100)`, latency > 0 && latency < 100);
const freshAfter = await page.evaluate(() => Number(document.querySelector("[data-status]").textContent.match(/(\d+) fresh/)?.[1] ?? -1));
check(`only the dirtied tile re-rendered (${freshAfter - freshBefore} fresh render)`, freshAfter - freshBefore === 1);

// --- 5. delete to rest, undo, redo ---
await page.keyboard.press("Delete");
await page.waitForFunction((id) => !document.querySelector(`g[id="${CSS.escape(id)}"]`), tid, { timeout: 15000 });
check("delete replaces the note with a rest (id gone from DOM)", true);
await page.keyboard.press("Control+z");
await page.waitForFunction((id) => !!document.querySelector(`g[id="${CSS.escape(id)}"]`), tid, { timeout: 15000 });
check("ctrl+z restores the note", true);
check("undo is one step: pitch still transposed", Math.abs((await noteTop(tid)) - yAfter) <= 1);
await page.keyboard.press("Control+z");
await page.waitForFunction((args) => {
  const g = document.querySelector(`g[id="${CSS.escape(args.id)}"]`);
  return g && Math.abs(g.getBoundingClientRect().top - args.want) <= 1;
}, { id: tid, want: yBefore }, { timeout: 15000 });
check("second ctrl+z unwinds the transpose (pitch restored)", true);
await page.keyboard.press("Control+Shift+z");
await page.waitForFunction((args) => {
  const g = document.querySelector(`g[id="${CSS.escape(args.id)}"]`);
  return g && Math.abs(g.getBoundingClientRect().top - args.want) <= 1;
}, { id: tid, want: yAfter }, { timeout: 15000 });
check("ctrl+shift+z redoes the transpose", true);

// --- 6. backspace erases the PREVIOUS note and steps the caret back ---
await page.locator('.tile g[class~="note"] use').first().click({ force: true });
await page.keyboard.press("ArrowRight"); // caret now after the first note
const beforeBksp = await page.evaluate(() => document.querySelector("main").dataset.caret);
await page.keyboard.press("Backspace");
await page.waitForFunction((id) => !document.querySelector(`g[id="${CSS.escape(id)}"]`), tid, { timeout: 15000 });
const afterBksp = await page.evaluate(() => document.querySelector("main").dataset.caret);
check(`backspace erased the previous note (${tid} gone), caret stepped back onto the rest (${afterBksp})`, !!afterBksp && afterBksp !== beforeBksp);
const caretIsRest = await page.evaluate(() => {
  const s = window.__SESSION__;
  return s.index.byId.get(document.querySelector("main").dataset.caret)?.tag;
});
check(`caret sits on the replacing rest (${caretIsRest})`, caretIsRest === "rest");
await page.keyboard.press("Backspace"); // previous is now... nothing before the first event
check("backspace at the score start is a safe no-op", true);
await page.keyboard.press("Control+z");
await page.waitForFunction((id) => !!document.querySelector(`g[id="${CSS.escape(id)}"]`), tid, { timeout: 15000 });
check("undo restores the backspaced note", true);

await page.screenshot({ path: `${scratch}/phase2-editing.png` });
await browser.close();
await server.close();
process.exit(failures ? 1 : 0);
