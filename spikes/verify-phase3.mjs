/**
 * Phase 3 end-to-end check — the workflow the project exists for:
 *  1. block-select measures × staff by dragging across tiles
 *  2. ctrl+c copies (fragment + system clipboard text)
 *  3. within-doc paste to a different staff (replace-measures, validated)
 *  4. cross-document paste through a second tab (shared clipboard)
 *  5. structural: insert/duplicate/delete measures + undo
 *  6. save; exported MEI re-parses, passes the duration validator, and
 *     renders in a fresh Verovio toolkit
 * Run: node spikes/verify-phase3.mjs
 */
import { createServer } from "vite";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { fromDom, buildScore, resolveContexts, validateMeasureDurations } from "../packages/core/dist/index.js";

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
const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
page.on("dialog", (d) => d.accept());
await page.goto(server.resolvedUrls.local[0]);
const waitTiles = (n) => page.waitForFunction((n) => document.querySelectorAll(".tile .ms").length >= n, n, { timeout: 60000 });
await waitTiles(10);

/** Count notes in staff n of measure index m via the exposed session. */
const notesIn = (m, n) =>
  page.evaluate(({ m, n }) => {
    const count = (el) => {
      let c = el.tag === "note" ? 1 : 0;
      for (const ch of el.children) if (typeof ch !== "string") c += count(ch);
      return c;
    };
    const measure = window.__SESSION__.score.measures[m];
    const staff = measure.children.find((c) => typeof c !== "string" && c.tag === "staff" && (c.attrs.n ?? "1") === String(n));
    return staff ? count(staff) : -1;
  }, { m, n });

const staffCenter = async (tileIndex, staffOrdinal) => {
  return page.evaluate(({ tileIndex, staffOrdinal }) => {
    const tile = document.querySelector(`.tile[data-index="${tileIndex}"]`);
    const staves = tile.querySelectorAll("g.staff[id]");
    const r = staves[staffOrdinal].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { tileIndex, staffOrdinal });
};

// --- 1. block-select m2..m3 × staff 1 by dragging ---
const from = await staffCenter(1, 0);
const to = await staffCenter(2, 0);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move(to.x, to.y, { steps: 5 });
await page.mouse.up();
const blockAttr = await page.evaluate(() => document.querySelector("main").dataset.block);
check(`drag creates a block selection (${blockAttr})`, blockAttr === "1-2/1-1");

// --- 2. copy ---
await page.keyboard.press("Control+c");
await page.waitForFunction(() => document.querySelector("[data-status]").textContent.includes("clip"), null, { timeout: 5000 });
check("ctrl+c stores the fragment (HUD shows clip 2m × 1s)", (await page.locator("header").textContent()).includes("clip 2m × 1s"));
const clipText = await page.evaluate(() => navigator.clipboard.readText());
check("system clipboard carries readable MEI text", clipText.includes("battuta clipboard: 2 measure(s)"));

// --- 3. within-doc paste into staff 2 at m5 ---
const m2s1Notes = await notesIn(1, 1);
const preNotes = await notesIn(4, 2);
const target = await staffCenter(4, 1); // staff 2 of tile m5
await page.mouse.click(target.x, target.y); // caret near staff 2
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
const caretStaff = await page.evaluate(() => window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret)?.staffN);
check(`clicking staff 2 places the caret there (staff ${caretStaff})`, caretStaff === 2);
await page.keyboard.press("Control+v");
await page.waitForFunction((want) => {
  const count = (el) => {
    let c = el.tag === "note" ? 1 : 0;
    for (const ch of el.children) if (typeof ch !== "string") c += count(ch);
    return c;
  };
  const staff = window.__SESSION__.score.measures[4].children.find((c) => typeof c !== "string" && c.tag === "staff" && (c.attrs.n ?? "1") === "2");
  return staff && count(staff) === want;
}, m2s1Notes, { timeout: 10000 });
check(`paste replaced staff 2 content of m5 (notes ${preNotes} -> ${m2s1Notes})`, true);
await page.keyboard.press("Control+z");
await page.waitForFunction((want) => {
  const count = (el) => {
    let c = el.tag === "note" ? 1 : 0;
    for (const ch of el.children) if (typeof ch !== "string") c += count(ch);
    return c;
  };
  const staff = window.__SESSION__.score.measures[4].children.find((c) => typeof c !== "string" && c.tag === "staff" && (c.attrs.n ?? "1") === "2");
  return staff && count(staff) === want;
}, preNotes, { timeout: 10000 });
check("undo restores the pasted staff", true);

// --- 4. cross-document paste: open chorale, copy, paste into doc 1 ---
await page.selectOption("select", "Bach-JS_Ein_feste_Burg.mei");
await waitTiles(14);
// m2..m3 (indexes 1-2): full 4/4 measures — the chorale also contains short
// phrase-upbeat measures (metcon=false) which the validator rightly refuses
// to paste into full measures (that refusal is itself covered below).
const cFrom = await staffCenter(1, 0);
const cTo = await staffCenter(2, 0);
await page.mouse.move(cFrom.x, cFrom.y);
await page.mouse.down();
await page.mouse.move(cTo.x, cTo.y, { steps: 5 });
await page.mouse.up();
check("chorale block selected", (await page.evaluate(() => document.querySelector("main").dataset.block)) === "1-2/1-1");
await page.keyboard.press("Control+c");
const choraleNotes = await Promise.all([notesIn(1, 1), notesIn(2, 1)]);
await page.locator(".tabs .tab").first().click(); // back to doc 1
await waitTiles(10);
const t2 = await staffCenter(0, 1); // m1, staff 2
await page.mouse.click(t2.x, t2.y);
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.keyboard.press("Control+v"); // keysig/meter warnings auto-accepted
await page.waitForFunction((want) => {
  const count = (el) => {
    let c = el.tag === "note" ? 1 : 0;
    for (const ch of el.children) if (typeof ch !== "string") c += count(ch);
    return c;
  };
  const staff = window.__SESSION__.score.measures[0].children.find((c) => typeof c !== "string" && c.tag === "staff" && (c.attrs.n ?? "1") === "2");
  return staff && count(staff) === want;
}, choraleNotes[0], { timeout: 10000 });
check(`cross-document paste landed chorale content in doc 1 staff 2 (${choraleNotes[0]} notes)`, true);

// --- 4b. the duration validator refuses invalid pastes loudly ---
await page.locator(".tabs .tab").nth(1).click(); // chorale
await waitTiles(14);
const uFrom = await staffCenter(5, 0); // short phrase-upbeat measure (1/4)
await page.mouse.move(uFrom.x, uFrom.y);
await page.mouse.down();
await page.mouse.move(uFrom.x + 40, uFrom.y + 4, { steps: 3 });
const uTo = await staffCenter(6, 0);
await page.mouse.move(uTo.x, uTo.y, { steps: 3 });
await page.mouse.up();
await page.keyboard.press("Control+c");
await page.locator(".tabs .tab").first().click();
await waitTiles(10);
const t3 = await staffCenter(1, 0);
await page.mouse.click(t3.x, t3.y);
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.keyboard.press("Control+v");
await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("paste refused"), null, { timeout: 5000 });
check("pasting a short (metcon=false) measure into a full one is refused with a duration reason", (await page.evaluate(() => document.querySelector("[data-notice]").textContent)).includes("duration mismatch"));

// --- 5. structural ---
// Place the caret explicitly (structural ops clear it afterwards).
const s1 = await staffCenter(1, 0);
await page.mouse.click(s1.x, s1.y);
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
const measureCount = await page.evaluate(() => window.__SESSION__.score.measures.length);
await page.locator("button", { hasText: "+m" }).click();
await page.waitForFunction((n) => window.__SESSION__.score.measures.length === n + 1, measureCount, { timeout: 10000 });
check("insert adds a measure", true);
// Regression: the inserted measure must actually RENDER (it was stuck as a
// gray placeholder because new tiles were never observed).
await page.waitForFunction((n) => document.querySelectorAll(".tile .ms").length >= n + 1, measureCount, { timeout: 10000 });
check("inserted measure renders as notation, not a placeholder", true);
// Regression: -m must not crash on the last tile / stale visible indexes.
const del = await staffCenter(2, 0); // caret on the inserted empty measure (index 2)
await page.mouse.click(del.x, del.y);
await page.locator("button", { hasText: "−m" }).click();
await page.waitForFunction((n) => window.__SESSION__.score.measures.length === n, measureCount, { timeout: 10000 });
const appAlive = await page.evaluate(() => document.querySelectorAll(".tile").length > 0);
check("delete removes exactly the targeted measure and the app survives", appAlive);
await page.keyboard.press("Control+z");
await page.waitForFunction((n) => window.__SESSION__.score.measures.length === n + 1, measureCount, { timeout: 10000 });
await page.keyboard.press("Control+z");
await page.waitForFunction((n) => window.__SESSION__.score.measures.length === n, measureCount, { timeout: 10000 });
check("undo unwinds both structural ops", true);

// --- 6. save + reopen through core and Verovio ---
const [download] = await Promise.all([page.waitForEvent("download"), page.locator("button", { hasText: "save" }).click()]);
const savedPath = `${scratch}/phase3-saved.mei`;
await download.saveAs(savedPath);
const savedXml = readFileSync(savedPath, "utf8");
const score = buildScore(fromDom(new DOMParser().parseFromString(savedXml, "application/xml").documentElement));
const contexts = resolveContexts(score);
let durationProblems = 0;
score.measures.forEach((m, i) => {
  for (const [staffN, staffCtx] of contexts[i]) durationProblems += validateMeasureDurations(m, staffCtx.meter, staffN).length;
});
check(`saved file re-parses (${score.measures.length} measures) with 0 duration problems`, durationProblems === 0);
const VerovioModule = await createVerovioModule();
const toolkit = new VerovioToolkit(VerovioModule);
check("saved file renders in a fresh Verovio toolkit", toolkit.loadData(savedXml) && toolkit.getPageCount() >= 1);

await page.screenshot({ path: `${scratch}/phase3-arranging.png` });
await browser.close();
await server.close();
process.exit(failures ? 1 : 0);
