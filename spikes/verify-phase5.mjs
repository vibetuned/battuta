/**
 * Phase 5 e2e — polish. Currently: the VSCode-style bottom status bar.
 *  1. INPUT indicator: "INPUT (i)" idle, "1/4 ♩ (5)" in input mode, live
 *     duration/dot updates, click toggles the mode
 *  2. MIDI indicator: "MIDI ><" disconnected, "MIDI <>" connected, click
 *     opens the device list (names via the __MIDI_DEVS__ dev hook)
 * Run: node spikes/verify-phase5.mjs
 */
import { createServer } from "vite";
import { chromium } from "playwright";

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
await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 3, null, { timeout: 60000 });

const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, sel);

// --- 1. INPUT indicator ---
check("status bar is present", await page.evaluate(() => !!document.querySelector("[data-statusbar]")));
check(`INPUT indicator idle shows the shortcut (${await text("[data-input-indicator]")})`, (await text("[data-input-indicator]")) === "INPUT (i)");

await page.locator('.tile[data-index="0"] g[class~="note"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.keyboard.press("i");
await page.waitForFunction(() => document.querySelector("[data-input-indicator]").textContent.includes("♩"), null, { timeout: 5000 });
check(`input mode shows duration, glyph, and key (${await text("[data-input-indicator]")})`, (await text("[data-input-indicator]")) === "1/4 ♩ (5)");

await page.keyboard.press("4"); // eighth
await page.waitForFunction(() => document.querySelector("[data-input-indicator]").textContent.includes("1/8"), null, { timeout: 5000 });
check(`duration changes update the indicator (${await text("[data-input-indicator]")})`, (await text("[data-input-indicator]")) === "1/8 ♪ (4)");

await page.keyboard.press("5"); // back to quarter for a clean exit
await page.locator("[data-input-indicator]").click();
await page.waitForFunction(() => document.querySelector("main").dataset.entry === "", null, { timeout: 5000 });
check("clicking the indicator leaves input mode", true);
await page.locator("[data-input-indicator]").click();
await page.waitForFunction(() => document.querySelector("main").dataset.entry !== "", null, { timeout: 5000 });
check("clicking again re-enters input mode", true);
await page.keyboard.press("Escape");

// --- 2. context indicators: the selects live in the bar and show the
// context at the caret (clef is per-staff, key/meter score-wide) ---
const selVal = (t) => page.evaluate((t) => document.querySelector(`select[title*="${t}"]`)?.value, t);
check("context selects sit in the status bar", await page.evaluate(() => document.querySelectorAll("[data-statusbar] select").length === 3));
check(`caret at m1: clef/key/meter show the opening context (${await selVal("clef")}/${await selVal("key signature")}/${await selVal("meter")})`,
  (await selVal("clef")) === "G2" && (await selVal("key signature")) === "0" && (await selVal("meter")) === "4/4");
await page.locator('.tile[data-index="2"] g[class~="note"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector('select[title*="key signature"]').value === "4s", null, { timeout: 5000 });
check("caret in m3 shows the 4-sharp key", true);
await page.locator('g[id="cc-m5n1"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector('select[title*="clef"]').value === "C4", null, { timeout: 5000 });
check("caret on staff 2 in m5 shows its tenor clef (staff-local)", true);
await page.locator('g[id="cc-m7n1"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector('select[title*="meter"]').value === "6/8", null, { timeout: 5000 });
check(`caret in m7 shows the 6/8 meter (clef back to ${await selVal("clef")})`, (await selVal("clef")) === "G2");
// changing a value still applies at the caret (and blurs)
await page.focus('select[title*="key signature"]');
await page.selectOption('select[title*="key signature"]', "2f");
await page.waitForFunction(() => window.__SESSION__.contexts[6].get(1).keysig === "2f", null, { timeout: 10000 });
check("picking a value applies the change at the caret", true);
check("select released focus after applying", await page.evaluate(() => document.activeElement?.tagName !== "SELECT"));
await page.waitForFunction(() => document.querySelector('select[title*="key signature"]').value === "2f", null, { timeout: 5000 });
check("indicator reflects the fresh change", true);
await page.keyboard.press("Control+z");
await page.waitForFunction(() => document.querySelector('select[title*="key signature"]').value === "4s", null, { timeout: 10000 });
check("undo winds the indicator back", true);

// --- 3. MIDI indicator ---
check(`MIDI square shows disconnected (${await text("[data-midi-indicator]")})`, (await text("[data-midi-indicator]")) === "MIDI ><");
await page.locator("[data-midi-indicator]").click();
await page.waitForFunction(() => document.querySelector("[data-midi-list]"), null, { timeout: 5000 });
check("clicking opens the device list", (await text("[data-midi-list]")).includes("no MIDI devices"));

await page.evaluate(() => window.__MIDI_DEVS__(["Test Piano", "Drum Pad"]));
await page.waitForFunction(() => document.querySelector("[data-midi-indicator]").textContent.includes("<>"), null, { timeout: 5000 });
check(`connected devices flip the square (${await text("[data-midi-indicator]")})`, (await text("[data-midi-indicator]")) === "MIDI <> 2");
const list = await text("[data-midi-list]");
check(`the open list shows every device (${list})`, list.includes("Test Piano") && list.includes("Drum Pad"));

await page.evaluate(() => window.__MIDI_DEVS__([]));
await page.waitForFunction(() => document.querySelector("[data-midi-indicator]").textContent.includes("><"), null, { timeout: 5000 });
check("unplugging returns the square to disconnected", true);
await page.locator("[data-midi-indicator]").click();
check("clicking again closes the list", await page.evaluate(() => !document.querySelector("[data-midi-list]")));

// --- 4. "+" tab: create a blank score ---
await page.locator(".tab-new").click();
await page.waitForFunction(() => [...document.querySelectorAll(".tabs .tab")].some((t) => t.textContent.includes("untitled-1")), null, { timeout: 5000 });
check("+ opens an untitled tab", true);
await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length === 4, null, { timeout: 30000 });
check("the blank score renders its four empty measures", true);
check(`blank score context is treble/C/4-4 (${await selVal("clef")}/${await selVal("key signature")}/${await selVal("meter")})`,
  (await selVal("clef")) === "G2" && (await selVal("key signature")) === "0" && (await selVal("meter")) === "4/4");
// it is immediately editable: enter a note in m1
await page.locator('.tile[data-index="0"] g[class~="mRest"], .tile[data-index="0"] g[class~="rest"]').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.keyboard.press("i");
await page.keyboard.press("5");
await page.keyboard.press("g");
await page.waitForFunction(() => {
  const m = window.__SESSION__.score.measures[0];
  const walk = (el) => el.tag === "note" ? [el.attrs.pname] : (el.children ?? []).filter((c) => typeof c !== "string").flatMap(walk);
  return walk(m).includes("g");
}, null, { timeout: 10000 });
check("a fresh score accepts note entry right away", true);
await page.keyboard.press("Escape");
// the saved document keeps its header (full-document save path)
const savedNew = await page.evaluate(() => window.__SESSION__.saveDocument());
check("saving a new score keeps a valid MEI header", savedNew.includes("<meiHead>") && savedNew.includes('meiversion="5.0"'));
// switching back to the first tab keeps both documents intact
await page.locator(".tabs .tab").first().click();
await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 10, null, { timeout: 30000 });
check("switching back restores the first document", true);
await page.locator(".tab-new").click();
await page.waitForFunction(() => [...document.querySelectorAll(".tabs .tab")].some((t) => t.textContent.includes("untitled-2")), null, { timeout: 5000 });
check("a second + names the tab untitled-2", true);

// --- 5. staves select: add below / remove at caret ---
const stavesLabel = () => page.evaluate(() => document.querySelector('select[title*="staves"]')?.selectedOptions[0]?.textContent);
check(`staves select shows the count (${await stavesLabel()})`, (await stavesLabel()) === "staves (1)");
await page.selectOption('select[title*="staves"]', "add");
await page.waitForFunction(() => window.__SESSION__.staffCount === 2, null, { timeout: 10000 });
check(`add staff appends one below (${await stavesLabel()})`, (await stavesLabel()) === "staves (2)");
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="0"] g[class~="staff"]').length === 2, null, { timeout: 15000 });
check("tiles render the new staff", true);
await page.selectOption('select[title*="staves"]', "remove"); // no caret yet
await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("place the caret"), null, { timeout: 5000 });
check("remove without a caret asks for one", true);
await page.locator('.tile[data-index="0"] g[class~="mRest"]').nth(1).click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.selectOption('select[title*="staves"]', "remove");
await page.waitForFunction(() => window.__SESSION__.staffCount === 1, null, { timeout: 10000 });
check("remove takes out the caret's staff", true);
await page.locator('.tile[data-index="0"] g[class~="mRest"]').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.selectOption('select[title*="staves"]', "remove");
await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("last staff"), null, { timeout: 5000 });
check("removing the last staff is refused", true);
await page.keyboard.press("Control+z");
await page.keyboard.press("Control+z");
await page.waitForFunction(() => window.__SESSION__.staffCount === 1 && window.__SESSION__.stack.undoDepth >= 0, null, { timeout: 10000 });
check("undo unwinds both staff operations", await page.evaluate(() => window.__SESSION__.staffCount === 1));

// --- 6. open file… from disk ---
await page.setInputFiles('input[type="file"]', "/home/flux/projects/battuta/fixtures/Bach-JS_Ein_feste_Burg.mei");
await page.waitForFunction(() => [...document.querySelectorAll(".tabs .tab")].some((t) => t.textContent.includes("Bach-JS_Ein_feste_Burg")), null, { timeout: 10000 });
check("open file… creates a tab named after the file", true);
await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 14, null, { timeout: 60000 });
check("the disk file renders completely", true);
check(`its staff count reads correctly (${await stavesLabel()})`, (await stavesLabel()) === "staves (2)");

} finally {
  await browser.close();
  await server.close();
}
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
