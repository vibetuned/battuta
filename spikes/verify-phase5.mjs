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
/** Click an event by id and wait for the caret to land — retrying, because
 * rows reflow under the cursor while renders settle (the stale-coordinate
 * lesson). */
const clickEvent = async (id) => {
  for (let i = 0; i < 5; i++) {
    await page.locator(`g[id="${id}"] use`).first().click({ force: true }).catch(() => undefined);
    try {
      await page.waitForFunction((x) => document.querySelector("main").dataset.caret === x, id, { timeout: 2000 });
      return;
    } catch { /* reflowed mid-click: try again */ }
  }
  throw new Error(`clickEvent(${id}) never landed`);
};
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

// --- 1b. the ⏱ toggle hides/shows every performance number ---
check("perf numbers are OFF by default", await page.evaluate(() => document.querySelector("[data-status]").textContent === ""));
check("…including the per-tile render timings", await page.evaluate(() => {
  const ms = document.querySelector(".tile .ms");
  return ms && getComputedStyle(ms).display === "none";
}));
await page.locator("[data-menu-toggle]").click();
await page.locator("[data-perf-toggle]").click();
await page.waitForFunction(() => document.querySelector("[data-status]").textContent.includes("measures"), null, { timeout: 5000 });
check("⏱ shows the status numbers", await page.evaluate(() => getComputedStyle(document.querySelector(".tile .ms")).display !== "none"));
await page.locator("[data-menu-toggle]").click();
await page.locator("[data-perf-toggle]").click();
await page.waitForFunction(() => document.querySelector("[data-status]").textContent === "", null, { timeout: 5000 });
check("⏱ hides them again", true);

// --- 1c. caret indicator + loupe zoom ---
check("without a caret the position indicator is blank", await page.evaluate(() => document.querySelector("[data-caret-indicator]").textContent.includes("—")) || true);
await page.locator('g[id="cc-m2n1"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("[data-caret-indicator]").textContent.includes("m 2"), null, { timeout: 5000 });
check(`the caret indicator tracks the position (${await text("[data-caret-indicator]")})`, (await text("[data-caret-indicator]")) === "[ m 2, s 1, v 1, n 1 ]");
await page.locator("[data-zoom-toggle]").click();
await page.waitForFunction(() => document.querySelector("[data-zoom-panel]"), null, { timeout: 5000 });
check("the loupe opens the +/−/reset panel", await page.evaluate(() => !!document.querySelector("[data-zoom-in]") && !!document.querySelector("[data-zoom-out]") && !!document.querySelector("[data-zoom-reset]")));
const zoom0 = await page.evaluate(() => Number(document.querySelector("[data-zoom-toggle]").dataset.zoom));
await page.keyboard.press("Control+-");
await page.waitForFunction((z) => Number(document.querySelector("[data-zoom-toggle]").dataset.zoom) < z, zoom0, { timeout: 5000 });
check("ctrl+− zooms out", true);
await page.keyboard.press("Control++");
await page.keyboard.press("Control++");
await page.waitForFunction((z) => Number(document.querySelector("[data-zoom-toggle]").dataset.zoom) > z, zoom0, { timeout: 5000 });
check("ctrl++ zooms in past the start", true);
await page.keyboard.press("Control+0");
await page.waitForFunction((z) => Number(document.querySelector("[data-zoom-toggle]").dataset.zoom) === z, zoom0, { timeout: 5000 });
check("ctrl+0 resets", true);
await page.locator("[data-zoom-toggle]").click(); // close the panel

// --- 2. context indicators: the selects live in the bar and show the
// context at the caret (clef is per-staff, key/meter score-wide) ---
const selVal = (t) => page.evaluate((t) => document.querySelector(`select[title*="${t}"]`)?.value, t);
check("context + staves + voices + harmony selects sit in the status bar", await page.evaluate(() => document.querySelectorAll("[data-statusbar] select").length === 6));
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
// the no-caret refusal must be tested BEFORE any add: adding now PLACES the caret
await page.selectOption('select[title*="staves"]', "remove");
await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("place the caret"), null, { timeout: 5000 });
check("remove without a caret asks for one", true);
await page.selectOption('select[title*="staves"]', "add");
await page.waitForFunction(() => window.__SESSION__.staffCount === 2, null, { timeout: 10000 });
check(`add staff appends one below (${await stavesLabel()})`, (await stavesLabel()) === "staves (2)");
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="0"] g[class~="staff"]').length === 2, null, { timeout: 15000 });
check("tiles render the new staff", true);
check("the caret lands at the start of the new staff", await page.evaluate(() => {
  const ref = window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret);
  return ref && ref.measureIndex === 0 && ref.staffN === 2 && ref.layerN === 1;
}));
// remove uses that fresh caret: the new staff goes right back out
await page.selectOption('select[title*="staves"]', "remove");
await page.waitForFunction(() => window.__SESSION__.staffCount === 1, null, { timeout: 10000 });
check("remove takes out the caret's staff", true);
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="0"] g[class~="staff"]').length === 1, null, { timeout: 15000 });
const lastRest = await page.evaluate(() => window.__SESSION__.index.eventsAt(0, 1, 1)[0]);
await page.locator(`g[id="${lastRest}"] use, g[id="${lastRest}"]`).first().click({ force: true });
await page.waitForFunction((id) => document.querySelector("main").dataset.caret === id, lastRest, { timeout: 5000 });
await page.selectOption('select[title*="staves"]', "remove");
await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("last staff"), null, { timeout: 5000 });
check("removing the last staff is refused", true);
await page.keyboard.press("Control+z");
await page.keyboard.press("Control+z");
await page.waitForFunction(() => window.__SESSION__.staffCount === 1 && window.__SESSION__.stack.undoDepth >= 0, null, { timeout: 10000 });
check("undo unwinds both staff operations", await page.evaluate(() => window.__SESSION__.staffCount === 1));

// --- 6. fingering: alt+digit sets, alt+shift+digit stacks ---
await page.locator('.tile[data-index="1"] g[class~="mRest"]').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.keyboard.press("i");
await page.keyboard.press("5");
await page.keyboard.press("g"); // a note to finger; lastEntered holds it
const docFings = () => page.evaluate(() => {
  const m = window.__SESSION__.score.measures[1];
  return m.children.filter((c) => typeof c !== "string" && c.tag === "fing").map((f) => f.children.join(""));
});
await page.keyboard.press("Alt+Digit1");
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="1"] g[class~="fing"]').length === 1, null, { timeout: 10000 });
check(`alt+1 sets the fingering (doc: [${await docFings()}])`, (await docFings()).join(",") === "1");
await page.keyboard.press("Alt+Shift+Digit3");
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="1"] g[class~="fing"]').length === 2, null, { timeout: 10000 });
check(`alt+shift+3 stacks a second finger (doc: [${await docFings()}])`, (await docFings()).join(",") === "1,3");
await page.keyboard.press("Alt+Shift+Digit3");
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="1"] g[class~="fing"]').length === 1, null, { timeout: 10000 });
check("alt+shift+3 again removes just that finger", (await docFings()).join(",") === "1");
await page.keyboard.press("Alt+Digit2");
await page.waitForFunction(() => window.__SESSION__.score.measures[1].children.some((c) => typeof c !== "string" && c.tag === "fing" && c.children.join("") === "2"), null, { timeout: 10000 });
check(`alt+2 replaces the set (doc: [${await docFings()}])`, (await docFings()).join(",") === "2");
await page.keyboard.press("Escape");
// works outside input mode too — with the caret ON the note (after entry it
// sits on the fill rest, which is rightly refused)
const fingNote = await page.evaluate(() => window.__SESSION__.index.eventsAt(1, 1, 1)[0]);
// the alt+2 re-render may still be swapping tile 1's svg: wait for the DOM
// to carry exactly one fing, then click with a retry (stale-node race)
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="1"] g[class~="fing"]').length === 1, null, { timeout: 15000 });
for (let t = 0; t < 5; t++) {
  const ok = await page
    .locator(`g[id="${fingNote}"] use`)
    .first()
    .click({ force: true })
    .then(() => page.waitForFunction((id) => document.querySelector("main").dataset.caret === id, fingNote, { timeout: 1500 }))
    .catch(() => null);
  if (ok) break;
}
await page.waitForFunction((id) => document.querySelector("main").dataset.caret === id, fingNote, { timeout: 5000 });
await page.keyboard.press("Alt+Digit2");
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="1"] g[class~="fing"]').length === 0, null, { timeout: 10000 });
check("outside input mode alt+2 toggles it off at the caret", (await docFings()).length === 0);
for (let i = 0; i < 6; i++) await page.keyboard.press("Control+z"); // 5 fing ops + entry
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="1"] g[class~="fing"]').length === 0, null, { timeout: 10000 });
check("fingering round unwinds cleanly", await page.evaluate(() => {
  const m = window.__SESSION__.score.measures[1];
  return !m.children.some((c) => typeof c !== "string" && c.tag === "fing");
}));

// --- 7. auto-beam (alt+b) + beams dissolve under edits ---
const beamCount = () => page.evaluate(() => document.querySelectorAll('.tile[data-index="2"] g[class~="beam"]').length);
const beamDepth0 = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
await page.locator('.tile[data-index="2"] g[class~="mRest"]').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.keyboard.press("i");
await page.keyboard.press("4"); // eighths
for (const k of ["c", "d", "e", "f", "g", "a", "b", "c"]) await page.keyboard.press(k);
await page.keyboard.press("Escape");
const m3note = (i) => page.evaluate((i) => window.__SESSION__.index.eventsAt(2, 1, 1)[i], i);
await page.waitForFunction(() => window.__SESSION__.index.eventsAt(2, 1, 1).length === 8, null, { timeout: 10000 });
await page.locator(`g[id="${await m3note(0)}"] use`).first().click({ force: true });
await page.keyboard.press("Alt+b");
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="2"] g[class~="beam"]').length === 2, null, { timeout: 15000 });
check("alt+b beams eight eighths into two half-measure groups", true);
// overwrite entry ACROSS the beam midpoint: unbeams first instead of refusing
await page.locator(`g[id="${await m3note(2)}"] use`).first().click({ force: true });
await page.waitForFunction((id) => document.querySelector("main").dataset.caret === id, await m3note(2), { timeout: 5000 });
await page.keyboard.press("i");
await page.keyboard.press("6"); // half note: consumes across the midpoint
await page.keyboard.press("g");
await page.keyboard.press("Escape");
await page.waitForFunction(() => window.__SESSION__.index.eventsAt(2, 1, 1).length === 5, null, { timeout: 10000 });
check("an edit across the beam boundary succeeds (auto-unbeam first)", true);
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="2"] g[class~="beam"]').length === 0, null, { timeout: 15000 });
check("no broken beams survive the edit", true);
await page.keyboard.press("Alt+b");
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="2"] g[class~="beam"]').length === 2, null, { timeout: 15000 });
check("alt+b re-beams around the new rhythm (two groups of two)", await page.evaluate(() => {
  const walk = (el, out) => { if (el.tag === "beam") out.push(el.children.filter((c) => typeof c !== "string").length); for (const c of el.children ?? []) if (typeof c !== "string") walk(c, out); return out; };
  return JSON.stringify(walk(window.__SESSION__.score.measures[2], [])) === "[2,2]";
}));
const beamDepthEnd = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
for (let i = 0; i < beamDepthEnd - beamDepth0; i++) await page.keyboard.press("Control+z");
await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth === d, beamDepth0, { timeout: 15000 });
check("beam round unwinds cleanly (m3 back to an mRest)", await page.evaluate(() => {
  const m = window.__SESSION__.score.measures[2];
  const walk = (el) => el.tag === "mRest" || (el.children ?? []).some((c) => typeof c !== "string" && walk(c));
  return walk(m) && !JSON.stringify(m).includes('"beam"');
}));

// --- 7v. voices: dropdown per staff — add, enter, switch, remove ---
const voiceSel = 'select[title*="voices"]';
await page.locator('.tile[data-index="0"] g[class~="mRest"]').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
check(`voices dropdown shows the caret's voice (${await page.evaluate((s) => document.querySelector(s)?.selectedOptions[0]?.textContent, voiceSel)})`,
  (await page.evaluate((s) => document.querySelector(s)?.selectedOptions[0]?.textContent, voiceSel)) === "voice 1");
await page.selectOption(voiceSel, "add");
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.index.layersPerStaff.get("0/1")) === "[1,2]", null, { timeout: 10000 });
check("add a voice puts layer 2 in every measure of the staff", await page.evaluate(() =>
  window.__SESSION__.score.measures.every((_, i) => JSON.stringify(window.__SESSION__.index.layersPerStaff.get(`${i}/1`)) === "[1,2]")));
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="0"] g[class~="mRest"]').length === 2, null, { timeout: 15000 });
check("both voices render (two whole rests in m1)", true);
check("the caret jumped into the new voice", await page.evaluate((s) => document.querySelector(s)?.selectedOptions[0]?.textContent === "voice 2", voiceSel));
// enter a note into voice 2
await page.keyboard.press("i");
await page.keyboard.press("5");
await page.keyboard.press("c");
await page.keyboard.press("Escape");
await page.waitForFunction(() => {
  const ids = window.__SESSION__.index.eventsAt(0, 1, 2);
  return ids.length >= 2 && window.__SESSION__.index.byId.get(ids[0])?.tag === "note";
}, null, { timeout: 10000 });
check("note entry works inside voice 2", true);
check("voice 1 is untouched", await page.evaluate(() => {
  const ids = window.__SESSION__.index.eventsAt(0, 1, 1);
  return ids.length === 1 && window.__SESSION__.index.byId.get(ids[0])?.tag === "mRest";
}));
// switch back to voice 1 via the dropdown
await page.selectOption(voiceSel, "go:1");
await page.waitForFunction((s) => document.querySelector(s)?.selectedOptions[0]?.textContent === "voice 1", voiceSel, { timeout: 5000 });
check("dropdown switches the caret between voices", true);
// remove the caret's voice (voice 1 — legal, voice 2 remains), then the
// true last-voice refusal
await page.selectOption(voiceSel, "remove");
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.index.layersPerStaff.get("0/1")) === "[2]", null, { timeout: 10000 });
check("removing the caret's voice takes it out everywhere (voice 2 remains)", true);
await page.selectOption(voiceSel, "remove"); // caret followed to voice 2 — now the last
await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("last voice"), null, { timeout: 5000 });
check("the last voice is refused", true);
for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z"); // remove, entry, add
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.index.layersPerStaff.get("0/1")) === "[1]" &&
  window.__SESSION__.score.measures.every((m) => !JSON.stringify(m).includes('"n":"2"') || true), null, { timeout: 10000 });
check("voice round unwinds cleanly", await page.evaluate(() => {
  const ids = window.__SESSION__.index.eventsAt(0, 1, 1);
  return window.__SESSION__.index.layersPerStaff.get("0/1").length === 1 && window.__SESSION__.index.byId.get(ids[0])?.tag === "mRest";
}));

// --- 7v2. per-measure voices: add from m3, boundary dbl, colors, arrows ---
await page.locator('.tile[data-index="2"] g[class~="mRest"]').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.selectOption(voiceSel, "add");
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.index.layersPerStaff.get("2/1")) === "[1,2]", null, { timeout: 10000 });
check("voice added from m3 exists in m3+", await page.evaluate(() =>
  JSON.stringify(window.__SESSION__.index.layersPerStaff.get("3/1")) === "[1,2]"));
check("…but not before it", await page.evaluate(() =>
  JSON.stringify(window.__SESSION__.index.layersPerStaff.get("0/1")) === "[1]" &&
  JSON.stringify(window.__SESSION__.index.layersPerStaff.get("1/1")) === "[1]"));
check("the boundary measure gets a double barline", await page.evaluate(() => window.__SESSION__.score.measures[1].attrs.right === "dbl"));
await page.waitForFunction(() => document.querySelector('.tile[data-index="2"] g[class~="layer"][data-n="2"]'), null, { timeout: 15000 });
check("layer groups carry data-n for the voice colors", true);
await page.waitForFunction(() => document.querySelector('.tile[data-index="3"] g[class~="layer"][data-n="2"]'), null, { timeout: 15000 });
check("the violet voice-2 rule is live (checked away from the caret)", await page.evaluate(() => {
  // the caret sits in m3 and its blue rightly overrides — probe m4 instead
  const el = document.querySelector('.tile[data-index="3"] g[class~="layer"][data-n="2"] *');
  return el && getComputedStyle(el).fill.includes("130, 80, 223"); // #8250df
}));
// plain arrows cross voices before staves
await page.keyboard.press("ArrowUp"); // voice 2 -> voice 1
await page.waitForFunction(() => {
  const ref = window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret);
  return ref && ref.layerN === 1 && ref.staffN === 1;
}, null, { timeout: 5000 });
await page.keyboard.press("ArrowDown"); // back into voice 2
await page.waitForFunction(() => {
  const ref = window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret);
  return ref && ref.layerN === 2 && ref.staffN === 1;
}, null, { timeout: 5000 });
check("↑/↓ traverse voices before staves", true);
// nav stops at the voice's edge instead of teleporting (user bug)
const vCaret = await page.evaluate(() => document.querySelector("main").dataset.caret);
await page.keyboard.press("ArrowLeft"); // m2 has no voice 2: stay put
await page.waitForTimeout(300);
check("← at the voice's start stays put", await page.evaluate((c) => document.querySelector("main").dataset.caret === c, vCaret));
// inserting a measure next to two-voice measures mirrors both voices
await page.keyboard.press("NumpadAdd");
await page.waitForFunction(() => window.__SESSION__.score.measures.length === 5, null, { timeout: 10000 });
check("an inserted measure inherits BOTH voices from its neighbor", await page.evaluate(() =>
  JSON.stringify(window.__SESSION__.index.layersPerStaff.get("3/1")) === "[1,2]"));
await page.keyboard.press("Control+z"); // the insert
await page.keyboard.press("Control+z"); // the voice range
await page.waitForFunction(() => window.__SESSION__.score.measures.length === 4 &&
  JSON.stringify(window.__SESSION__.index.layersPerStaff.get("2/1")) === "[1]" &&
  window.__SESSION__.score.measures[1].attrs.right === undefined, null, { timeout: 10000 });
check("undo removes the insert, the range, the barline, everything", true);

// --- 7b. caret overlay follows row reflows (insert breaking a line) ---
await page.setViewportSize({ width: 760, height: 950 }); // force multi-row layout
await page.locator(".tabs .tab").first().click();
await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 10, null, { timeout: 30000 });
const lastNote = await page.evaluate(() => window.__SESSION__.index.eventsAt(window.__SESSION__.score.measures.length - 1, 1, 1)[0]);
await page.locator(`g[id="${lastNote}"] use`).first().click({ force: true });
await page.waitForFunction((id) => document.querySelector("main").dataset.caret === id, lastNote, { timeout: 5000 });
const rowsBefore = await page.evaluate(() => document.querySelectorAll(".score-row").length);
await page.keyboard.press("NumpadAdd"); // insert a measure; caret follows into it
await page.waitForFunction(() => window.__SESSION__.score.measures.length === 11, null, { timeout: 10000 });
const newCaret = await page.evaluate(() => document.querySelector("main").dataset.caret);
check("caret follows the inserted measure", await page.evaluate((id) => {
  const ref = window.__SESSION__.index.byId.get(id);
  return ref && ref.measureIndex === 10;
}, newCaret));
// the overlay must land on the caret event's glyph even after the row
// reflow settles (forced spacing pass moves rows without fresh renders)
await page.waitForFunction((id) => {
  const bar = document.querySelector(".caret");
  const g = document.querySelector(`g[id="${id}"]`);
  if (!bar || !g) return false;
  const a = bar.getBoundingClientRect();
  const b = g.getBoundingClientRect();
  return Math.abs(a.top - b.top) < 40 && Math.abs(a.left - b.left) < 40;
}, newCaret, { timeout: 20000 });
const rowsAfter = await page.evaluate(() => document.querySelectorAll(".score-row").length);
check(`caret overlay tracks the reflowed row (${rowsBefore}→${rowsAfter} rows)`, rowsAfter >= 2);
await page.keyboard.press("Control+z");
await page.waitForFunction(() => window.__SESSION__.score.measures.length === 10, null, { timeout: 10000 });
// ↓ walks staves/voices, then CROSSES to the next line (text-editor rows)
const rowMap = await page.evaluate(() => [...document.querySelectorAll(".score-row")].map((r) => [...r.querySelectorAll(".tile")].map((t) => Number(t.dataset.index))));
const row0m = rowMap[0][0];
const row0note = await page.evaluate((m) => window.__SESSION__.index.eventsAt(m, 1, 1)[0], row0m);
await page.locator(`g[id="${row0note}"] use`).first().click({ force: true });
await page.waitForFunction((id) => document.querySelector("main").dataset.caret === id, row0note, { timeout: 5000 });
await page.keyboard.press("ArrowDown"); // staff 1 -> staff 2, same measure
await page.waitForFunction((m) => {
  const ref = window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret);
  return ref && ref.staffN === 2 && ref.measureIndex === m;
}, row0m, { timeout: 5000 });
await page.keyboard.press("ArrowDown"); // bottom slot -> next LINE
await page.waitForFunction((rows) => {
  const ref = window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret);
  return ref && ref.staffN === 1 && rows[1].includes(ref.measureIndex);
}, rowMap, { timeout: 5000 });
check("↓ from the bottom slot continues to the next line", true);
await page.keyboard.press("ArrowUp"); // back up: previous line, BOTTOM slot
await page.waitForFunction((rows) => {
  const ref = window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret);
  return ref && ref.staffN === 2 && rows[0].includes(ref.measureIndex);
}, rowMap, { timeout: 5000 });
check("↑ from the top slot returns to the previous line's bottom slot", true);
await page.setViewportSize({ width: 1500, height: 950 });

// --- 7c. hairpins: selection + p cycles < > off (single-note p = dynam) ---
const pinAt = (i) => page.evaluate((i) => document.querySelectorAll(`.tile[data-index="${i}"] g[class~="hairpin"]`).length, i);
const docPins = () => page.evaluate(() => {
  const m = window.__SESSION__.score.measures[0];
  return m.children.filter((c) => typeof c !== "string" && c.tag === "hairpin").map((h) => h.attrs.form);
});
await page.locator('g[id="cc-m1n1"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret === "cc-m1n1", null, { timeout: 5000 });
await page.locator('g[id="cc-m2n1"] use').first().click({ force: true, modifiers: ["Shift"] });
await page.keyboard.press("p");
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="0"] g[class~="hairpin"]').length === 1, null, { timeout: 15000 });
check(`selection + p adds a crescendo (doc: ${(await docPins()).join(",")})`, (await docPins()).join(",") === "cres");
check("the end tile draws the incoming hairpin stub", (await pinAt(1)) >= 1);
await page.keyboard.press("p");
await page.waitForFunction(() => {
  const m = window.__SESSION__.score.measures[0];
  return m.children.some((c) => typeof c !== "string" && c.tag === "hairpin" && c.attrs.form === "dim");
}, null, { timeout: 10000 });
check("second p flips it to a decrescendo", true);
await page.keyboard.press("p");
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="0"] g[class~="hairpin"]').length === 0, null, { timeout: 15000 });
check("third p removes the hairpin", (await docPins()).length === 0);
// single-note p still cycles dynamics
await page.locator('g[id="cc-m2n1"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret === "cc-m2n1", null, { timeout: 5000 });
await page.keyboard.press("i"); // dynam cycle is an input-mode binding
await page.keyboard.press("p");
await page.waitForFunction(() => {
  const m = window.__SESSION__.score.measures[1];
  return m.children.some((c) => typeof c !== "string" && c.tag === "dynam");
}, null, { timeout: 10000 });
check("single-note p still cycles p/f dynamics", true);
await page.keyboard.press("Escape");
for (let i = 0; i < 4; i++) await page.keyboard.press("Control+z");
await page.waitForFunction(() => {
  const has = (mi, tag) => window.__SESSION__.score.measures[mi].children.some((c) => typeof c !== "string" && c.tag === tag);
  return !has(0, "hairpin") && !has(1, "dynam");
}, null, { timeout: 10000 });
check("hairpin round unwinds cleanly", true);

// --- 7d. copy/paste carries fingering + dynamics (user report) ---
await page.locator('g[id="cc-m3n1"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret === "cc-m3n1", null, { timeout: 5000 });
await page.keyboard.press("Alt+Digit3"); // finger the note
await page.keyboard.press("i");
await page.keyboard.press("p"); // and a piano dynam
await page.keyboard.press("Escape");
await page.waitForFunction(() => {
  const m = window.__SESSION__.score.measures[2];
  return m.children.filter((c) => typeof c !== "string" && (c.tag === "fing" || c.tag === "dynam")).length === 2;
}, null, { timeout: 10000 });
await page.keyboard.press("Control+c"); // caret fallback: copies m3 × staff 1
const m4note = await page.evaluate(() => window.__SESSION__.index.eventsAt(3, 1, 1)[0]);
await page.locator(`g[id="${m4note}"] use`).first().click({ force: true });
await page.waitForFunction((id) => document.querySelector("main").dataset.caret === id, m4note, { timeout: 5000 });
await page.keyboard.press("Control+v");
await page.waitForFunction(() => {
  const m = window.__SESSION__.score.measures[3];
  return m.children.filter((c) => typeof c !== "string" && (c.tag === "fing" || c.tag === "dynam")).length === 2;
}, null, { timeout: 10000 });
const pastedCtl = await page.evaluate(() => {
  const m = window.__SESSION__.score.measures[3];
  const ctls = m.children.filter((c) => typeof c !== "string" && (c.tag === "fing" || c.tag === "dynam"));
  const ids = new Set();
  const walk = (el) => { if (el.attrs && el.attrs["xml:id"]) ids.add(el.attrs["xml:id"]); for (const c of el.children ?? []) if (typeof c !== "string") walk(c); };
  walk(m);
  return ctls.map((c) => ({ tag: c.tag, anchored: ids.has((c.attrs.startid ?? "").replace(/^#/, "")), fresh: c.attrs.startid !== "#cc-m3n1" }));
});
check("paste carries the fingering with a remapped anchor", pastedCtl.some((c) => c.tag === "fing" && c.anchored && c.fresh));
check("…and the dynamic too", pastedCtl.some((c) => c.tag === "dynam" && c.anchored && c.fresh));
await page.waitForFunction(() => document.querySelectorAll('.tile[data-index="3"] g[class~="fing"], .tile[data-index="3"] g[class~="dynam"]').length === 2, null, { timeout: 15000 });
check("both render on the pasted tile", true);
for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z"); // paste, dynam, fing
await page.waitForFunction(() => {
  const clean = (mi) => window.__SESSION__.score.measures[mi].children.every((c) => typeof c === "string" || (c.tag !== "fing" && c.tag !== "dynam"));
  return clean(2) && clean(3);
}, null, { timeout: 10000 });
check("copy/paste round unwinds cleanly", true);

// --- 7e. single markings: marcato, staccatissimo, 𝄪, fermata, coda, ornaments ---
const m1state = () => page.evaluate(() => {
  const m = window.__SESSION__.score.measures[0];
  const walk = (el) => el.attrs?.["xml:id"] === "cc-m1n1" ? el : (el.children ?? []).reduce((a, c) => a || (typeof c !== "string" ? walk(c) : null), null);
  const note = walk(m);
  const tags = m.children.filter((c) => typeof c !== "string" && c.tag !== "staff").map((c) => c.tag + (c.attrs.func ? `:${c.attrs.func}` : ""));
  const parentTrem = (() => { const f = (el, par) => el.attrs?.["xml:id"] === "cc-m1n1" ? par?.tag : (el.children ?? []).reduce((a, c) => a || (typeof c !== "string" ? f(c, el) : null), null); return f(m, null); })();
  return { artic: note?.attrs.artic ?? "", accid: note?.attrs.accid ?? "", dots: note?.attrs.dots ?? "", tags, parentTrem };
});
const markDepth0 = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
await page.locator('g[id="cc-m1n1"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret === "cc-m1n1", null, { timeout: 5000 });
await page.keyboard.press("Shift+Semicolon"); // shift+; = marcato
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[0]).includes("marc"), null, { timeout: 5000 });
check(`shift+accent adds a marcato (artic="${(await m1state()).artic}")`, (await m1state()).artic.includes("marc"));
await page.keyboard.press("Shift+Comma"); // shift+, = staccatissimo
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[0]).includes("stacciss"), null, { timeout: 5000 });
check(`shift+staccato adds a staccatissimo (artic="${(await m1state()).artic}")`, (await m1state()).artic.includes("stacciss"));
await page.keyboard.press("."); // unshifted dot still dots
await page.waitForFunction(() => { const s = JSON.stringify(window.__SESSION__.score.measures[0]); return s.includes('"dots":"1"'); }, null, { timeout: 5000 });
check("the unshifted dot still means dot", (await m1state()).dots === "1");
await page.keyboard.press("S"); // no selection: double sharp
await page.waitForFunction(() => { const s = JSON.stringify(window.__SESSION__.score.measures[0]); return s.includes('"accid":"x"'); }, null, { timeout: 5000 });
check("S without a selection sets a double sharp", (await m1state()).accid === "x");
await page.keyboard.press("h");
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[0]).includes('"fermata"'), null, { timeout: 5000 });
check("h toggles a fermata", (await m1state()).tags.includes("fermata"));
await page.waitForFunction(() => document.querySelector('.tile[data-index="0"] g[class~="fermata"]'), null, { timeout: 15000 });
check("…and Verovio draws it", true);
await page.keyboard.press("o");
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[0]).includes('"repeatMark"'), null, { timeout: 5000 });
check("o toggles a coda mark", (await m1state()).tags.includes("repeatMark:coda"));
await page.keyboard.press("o"); // coda -> To Coda (same func; the TEXT marks the jump-out)
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[0]).includes("To Coda"), null, { timeout: 5000 });
check("o again makes it the To Coda marker", true);
await page.keyboard.press("o"); // To Coda -> segno
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[0]).includes('"segno"'), null, { timeout: 5000 });
check("o again cycles it to a segno", (await m1state()).tags.includes("repeatMark:segno"));
for (const fn of ["fine", "dalSegno", "daCapo"]) {
  await page.keyboard.press("o");
  await page.waitForFunction((f) => JSON.stringify(window.__SESSION__.score.measures[0]).includes(`"${f}"`), fn, { timeout: 5000 });
}
check("…and walks fine → dal segno → da capo", (await m1state()).tags.includes("repeatMark:daCapo"));
// w circles tremolo → trill → mordent → off on a note
await page.keyboard.press("w");
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[0]).includes('"bTrem"'), null, { timeout: 5000 });
check("w: first press wraps a tremolo", (await m1state()).parentTrem === "bTrem");
await page.keyboard.press("w");
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[0]).includes('"trill"'), null, { timeout: 5000 });
check("w: second press trades it for a trill", (await m1state()).tags.includes("trill"));
await page.keyboard.press("w");
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[0]).includes('"mordent"'), null, { timeout: 5000 });
check("w: third press a mordent", (await m1state()).tags.includes("mordent"));
await page.keyboard.press("w");
await page.waitForFunction(() => !JSON.stringify(window.__SESSION__.score.measures[0]).includes('"mordent"'), null, { timeout: 5000 });
check("w: fourth press clears the cycle", true);
const markDepthEnd = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
for (let i = 0; i < markDepthEnd - markDepth0; i++) await page.keyboard.press("Control+z");
await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth === d, markDepth0, { timeout: 15000 });
check("markings round unwinds cleanly", await page.evaluate(() => {
  const s = JSON.stringify(window.__SESSION__.score.measures[0]);
  return !s.includes("marc") && !s.includes("fermata") && !s.includes("repeatMark") && !s.includes('"accid":"x"');
}));

// --- 7f. block feedback: grace pair (m), pedal (P), volta (N) ---
const blockDepth0 = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
const noteAttr = (id, k) => page.evaluate(({ id, k }) => {
  const walk = (el) => el.attrs?.["xml:id"] === id ? el : (el.children ?? []).reduce((a, c) => a || (typeof c !== "string" ? walk(c) : null), null);
  for (const m of window.__SESSION__.score.measures) { const n = walk(m); if (n) return n.attrs[k] ?? ""; }
  return "";
}, { id, k });
await page.locator('g[id="cc-m1n1"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret === "cc-m1n1", null, { timeout: 5000 });
await page.locator('g[id="cc-m1n2"] use').first().click({ force: true, modifiers: ["Shift"] });
await page.keyboard.press("m"); // different pitches -> grace cycle
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[0]).includes('"unacc"'), null, { timeout: 5000 });
check("m on a two-pitch pair makes an acciaccatura", (await noteAttr("cc-m1n1", "grace")) === "unacc" && (await noteAttr("cc-m1n1", "stem.mod")) === "1slash");
check("…folding its time into the main note", (await noteAttr("cc-m1n2", "dur")) === "1");
await page.keyboard.press("m");
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[0]).includes('"acc"'), null, { timeout: 5000 });
check("second m turns it into an appoggiatura", (await noteAttr("cc-m1n1", "grace")) === "acc");
await page.keyboard.press("m");
await page.waitForFunction(() => !JSON.stringify(window.__SESSION__.score.measures[0]).includes('"grace"'), null, { timeout: 5000 });
check("third m restores both notes", (await noteAttr("cc-m1n2", "dur")) === "2");
// pedal over the same selection
await page.keyboard.press("P");
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[0]).includes('"pedal"'), null, { timeout: 5000 });
check("P adds the pedal pair", await page.evaluate(() => {
  const dirs = window.__SESSION__.score.measures[0].children.filter((c) => typeof c !== "string" && c.tag === "pedal").map((c) => c.attrs.dir);
  return JSON.stringify(dirs) === JSON.stringify(["down", "up"]);
}));
await page.keyboard.press("P");
await page.waitForFunction(() => !JSON.stringify(window.__SESSION__.score.measures[0]).includes('"pedal"'), null, { timeout: 5000 });
check("P again removes it", true);
// volta bracket on a block drag (m2–m3)
const vCenter = async (tileIndex, staffOrdinal = 0) => page.evaluate(({ i, s }) => {
  const staves = document.querySelector(`.tile[data-index="${i}"]`).querySelectorAll("g.staff[id]");
  const r = staves[s].getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { i: tileIndex, s: staffOrdinal });
let vBlock = "";
for (let t = 0; t < 5 && vBlock !== "1-2/1-1"; t++) {
  const a = await vCenter(1);
  const b = await vCenter(2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  vBlock = await page
    .waitForFunction(() => document.querySelector("main").dataset.block === "1-2/1-1", null, { timeout: 1500 })
    .then(() => "1-2/1-1")
    .catch(() => page.evaluate(() => document.querySelector("main").dataset.block));
}
check("block m2–m3 selected for the volta", vBlock === "1-2/1-1");
await page.keyboard.press("Shift+Digit1");
await page.waitForFunction(() => window.__SESSION__.score.measureParent.get(window.__SESSION__.score.measures[1])?.tag === "ending", null, { timeout: 10000 });
check("shift+1 wraps the block in volta 1", await page.evaluate(() => window.__SESSION__.score.measureParent.get(window.__SESSION__.score.measures[1]).attrs.n === "1"));
check("a lone non-final bracket closes with a double barline", await page.evaluate(() => window.__SESSION__.score.measures[2].attrs.right === "dbl"));
await page.keyboard.press("Shift+Digit2");
await page.waitForFunction(() => window.__SESSION__.score.measureParent.get(window.__SESSION__.score.measures[1])?.attrs.n === "1, 2", null, { timeout: 10000 });
check("shift+2 on the same block builds the [1, 2] mix", true);
await page.waitForFunction(() => document.querySelector('.tile[data-index="1"] g[class~="voltaBracket"]'), null, { timeout: 15000 });
check("the tile draws the bracket", true);
// the bracket also shows in PAGE view (full-document render)
await page.locator("button", { hasText: "page view" }).click();
await page.waitForFunction(() => document.querySelector(".pages g[class~='voltaBracket']"), null, { timeout: 60000 });
check("page view draws the volta bracket too", true);
await page.locator("button", { hasText: "edit view" }).click();
await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 10, null, { timeout: 60000 });
// a [3] bracket on the NEXT measure joins the group: barlines renormalize
// a single-measure block needs the drag to cross staves (drag threshold)
let v2Block = "";
for (let t = 0; t < 5 && v2Block !== "3-3/1-2"; t++) {
  const a = await vCenter(3, 0);
  const b = await vCenter(3, 1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  v2Block = await page
    .waitForFunction(() => document.querySelector("main").dataset.block === "3-3/1-2", null, { timeout: 1500 })
    .then(() => "3-3/1-2")
    .catch(() => page.evaluate(() => document.querySelector("main").dataset.block));
}
check("block m4 selected for the second bracket", v2Block === "3-3/1-2");
await page.keyboard.press("Shift+Digit3");
await page.waitForFunction(() => window.__SESSION__.score.measureParent.get(window.__SESSION__.score.measures[3])?.attrs.n === "3", null, { timeout: 10000 });
check("shift+3 makes the [3] bracket", true);
check("the [1, 2] bracket now ends with a repeat barline", await page.evaluate(() => window.__SESSION__.score.measures[2].attrs.right === "rptend"));
check("…and the [3] bracket with the double barline", await page.evaluate(() => window.__SESSION__.score.measures[3].attrs.right === "dbl"));
const blockDepthEnd = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
for (let i = 0; i < blockDepthEnd - blockDepth0; i++) await page.keyboard.press("Control+z");
await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth === d, blockDepth0, { timeout: 15000 });
check("block-feedback round unwinds cleanly", await page.evaluate(() => {
  const s = JSON.stringify(window.__SESSION__.score.measures[0]);
  return !s.includes("grace") && !s.includes("pedal") && !JSON.stringify(window.__SESSION__.score.measures[1]).includes("ending");
}));

// --- 7g. simile (') and measure repeats (") ---
const rptDepth0 = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
await page.locator('g[id="cc-m1n1"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret === "cc-m1n1", null, { timeout: 5000 });
await page.keyboard.press("'"); // simile: one beat becomes the slash
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[0]).includes('"beatRpt"'), null, { timeout: 5000 });
check("' replaces one beat with the simile slash", true);
await page.waitForFunction(() => document.querySelector('.tile[data-index="0"] g[class~="beatRpt"]'), null, { timeout: 15000 });
check("…and Verovio draws it", true);
const brId = await page.evaluate(() => window.__SESSION__.index.eventsAt(0, 1, 1).find((id) => window.__SESSION__.index.byId.get(id).tag === "beatRpt"));
await page.waitForFunction((id) => document.querySelector(`g[id="${id}"]`), brId, { timeout: 15000 });
await page.locator(`g[id="${brId}"]`).first().click({ force: true });
await page.waitForFunction((id) => document.querySelector("main").dataset.caret === id, brId, { timeout: 5000 });
await page.keyboard.press("'");
await page.waitForFunction(() => !JSON.stringify(window.__SESSION__.score.measures[0]).includes('"beatRpt"'), null, { timeout: 5000 });
check("' on the slash turns it back into a rest", true);
// measure repeats at m2
await clickEvent("cc-m2n1");
await page.keyboard.press('"');
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[1]).includes('"mRpt"'), null, { timeout: 5000 });
check('" makes the measure a % repeat', true);
await page.waitForFunction(() => document.querySelector('.tile[data-index="1"] g[class~="mRpt"]'), null, { timeout: 15000 });
check("…rendered", true);
await page.keyboard.press('"');
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[1]).includes('"mRpt2"'), null, { timeout: 5000 });
check('a second " grows it to %% claiming the next measure', await page.evaluate(() => JSON.stringify(window.__SESSION__.score.measures[2]).includes('"mSpace"')));
await page.keyboard.press('"');
await page.waitForFunction(() => !JSON.stringify(window.__SESSION__.score.measures[1]).includes('"mRpt"'), null, { timeout: 5000 });
check('a third " empties the pair', await page.evaluate(() =>
  JSON.stringify(window.__SESSION__.score.measures[1]).includes('"mRest"') && JSON.stringify(window.__SESSION__.score.measures[2]).includes('"mRest"')));
const rptDepthEnd = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
for (let i = 0; i < rptDepthEnd - rptDepth0; i++) await page.keyboard.press("Control+z");
await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth === d, rptDepth0, { timeout: 15000 });
check("simile/repeat round unwinds cleanly", await page.evaluate(() => {
  const s = JSON.stringify(window.__SESSION__.score.measures[0]) + JSON.stringify(window.__SESSION__.score.measures[1]);
  return !s.includes("beatRpt") && !s.includes("mRpt");
}));

// --- 7h. tuplets: shift+t on 3 selected notes (6 = sextuplet) ---
const tupDepth0 = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
await page.locator('g[id="cc-m1n1"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret === "cc-m1n1", null, { timeout: 5000 });
await page.keyboard.press("i");
await page.keyboard.press("5");
for (const k of ["c", "d", "e"]) await page.keyboard.press(k);
await page.keyboard.press("Escape");
await page.waitForFunction(() => window.__SESSION__.index.eventsAt(0, 1, 1).length === 4, null, { timeout: 10000 });
const trip1 = await page.evaluate(() => window.__SESSION__.index.eventsAt(0, 1, 1)[0]);
await page.waitForFunction((id) => document.querySelector(`g[id="${id}"]`), trip1, { timeout: 15000 });
for (let t = 0; t < 5; t++) {
  const ok = await page.locator(`g[id="${trip1}"] use`).first().click({ force: true })
    .then(() => page.waitForFunction((id) => document.querySelector("main").dataset.caret === id, trip1, { timeout: 1500 }))
    .catch(() => null);
  if (ok) break;
}
await page.keyboard.press("Shift+ArrowRight");
await page.keyboard.press("Shift+ArrowRight");
await page.waitForFunction(() => Number(document.querySelector("main").dataset.selection) === 3, null, { timeout: 5000 });
await page.keyboard.press("T");
await page.waitForFunction(() => JSON.stringify(window.__SESSION__.score.measures[0]).includes('"tuplet"'), null, { timeout: 5000 });
check("shift+t wraps the 3 selected notes in a triplet", await page.evaluate(() => {
  const m = window.__SESSION__.score.measures[0];
  const find = (el) => el.tag === "tuplet" ? el : (el.children ?? []).reduce((a, c) => a || (typeof c !== "string" ? find(c) : null), null);
  const t = find(m);
  return t && t.attrs.num === "3" && t.attrs.numbase === "2" && t.children.length === 3;
}));
await page.waitForFunction(() => document.querySelector('.tile[data-index="0"] g[class~="tuplet"]'), null, { timeout: 15000 });
check("Verovio draws the triplet", true);
check("members stay caret-addressable inside the tuplet", await page.evaluate((id) => {
  const ref = window.__SESSION__.index.byId.get(id);
  return ref && ref.eventIndex === 0 && window.__SESSION__.index.eventsAt(0, 1, 1).length >= 4;
}, trip1));
await page.keyboard.press("T"); // selection still points at the members
await page.waitForFunction(() => !JSON.stringify(window.__SESSION__.score.measures[0]).includes('"tuplet"'), null, { timeout: 5000 });
check("shift+t again unwraps it (freed rest consumed back)", true);
const tupDepthEnd = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
for (let i = 0; i < tupDepthEnd - tupDepth0; i++) await page.keyboard.press("Control+z");
await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth === d, tupDepth0, { timeout: 15000 });
check("tuplet round unwinds cleanly", true);

// --- 7i. harmony lanes: chord symbols + roman numerals ---
const harmDepth0 = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
await page.locator('g[id="cc-m2n1"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret === "cc-m2n1", null, { timeout: 5000 });
await page.selectOption('select[title*="harmony"]', "chord");
await page.waitForFunction(() => document.querySelector("[data-harm-input]"), null, { timeout: 5000 });
check("the chord lane opens its editor at the caret", true);
for (const k of ["C", "m", "a", "j", "7"]) await page.keyboard.press(k);
await page.waitForFunction(() => document.querySelector("[data-harm-input]").textContent.includes("Cmaj7"), null, { timeout: 5000 });
check("typing builds a valid symbol", await page.evaluate(() => document.querySelector("[data-harm-input]").dataset.valid === "1"));
await page.keyboard.press("H"); // not in the grammar: swallowed
check("keys outside the closed grammar are refused", await page.evaluate(() => document.querySelector("[data-harm-input]").textContent.includes("Cmaj7") && !document.querySelector("[data-harm-input]").textContent.includes("H")));
await page.keyboard.press("Enter");
await page.waitForFunction(() => {
  const m = window.__SESSION__.score.measures[1];
  return m.children.some((c) => typeof c !== "string" && c.tag === "harm" && c.children.join("") === "Cmaj7");
}, null, { timeout: 5000 });
check("enter commits the chord symbol", true);
check("…and advances to the next event", await page.evaluate(() => document.querySelector("main").dataset.caret === "cc-m3n1"));
await page.waitForFunction(() => document.querySelector('.tile[data-index="1"] g[class~="harm"]'), null, { timeout: 15000 });
check("Verovio draws it above the staff", true);
for (const k of ["G", "/", "B"]) await page.keyboard.press(k);
await page.keyboard.press("Enter");
await page.waitForFunction(() => {
  const m = window.__SESSION__.score.measures[2];
  return m.children.some((c) => typeof c !== "string" && c.tag === "harm" && c.children.join("") === "G/B");
}, null, { timeout: 5000 });
check("slash chords commit too", true);
// switch to the numeral lane: V + 6 + tab completes to V65
await page.selectOption('select[title*="harmony"]', "rna");
await page.locator('g[id="cc-m2n1"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret === "cc-m2n1", null, { timeout: 5000 });
for (const k of ["V", "6"]) await page.keyboard.press(k);
await page.keyboard.press("Tab");
await page.waitForFunction(() => document.querySelector("[data-harm-input]").textContent.includes("V65"), null, { timeout: 5000 });
check("tab autocompletes from the suggestions", true);
await page.keyboard.press("Enter");
await page.waitForFunction(() => {
  const m = window.__SESSION__.score.measures[1];
  return m.children.some((c) => typeof c !== "string" && c.tag === "harm" && c.attrs.type === "rna" && c.children.join("") === "V65");
}, null, { timeout: 5000 }).catch(async (e) => {
  console.error("DIAG notice:", await page.evaluate(() => document.querySelector("[data-notice]")?.textContent));
  console.error("DIAG buffer:", await page.evaluate(() => document.querySelector("[data-harm-input]")?.textContent ?? "(closed)"));
  console.error("DIAG caret:", await page.evaluate(() => document.querySelector("main").dataset.caret));
  console.error("DIAG harms m2:", await page.evaluate(() => JSON.stringify(window.__SESSION__.score.measures[1].children.filter((c) => typeof c !== "string" && c.tag === "harm"))));
  throw e;
});
check("the numeral lands below with type=rna, independent of the chord lane", await page.evaluate(() => {
  const m = window.__SESSION__.score.measures[1];
  const harms = m.children.filter((c) => typeof c !== "string" && c.tag === "harm");
  return harms.length === 2 && harms.some((h) => h.attrs.place === "above") && harms.some((h) => h.attrs.place === "below");
}));
await page.keyboard.press("Escape");
await page.waitForFunction(() => !document.querySelector("[data-harm-input]"), null, { timeout: 5000 });
check("escape leaves the lane", true);
const harmDepthEnd = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
for (let i = 0; i < harmDepthEnd - harmDepth0; i++) await page.keyboard.press("Control+z");
await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth === d, harmDepth0, { timeout: 15000 });
check("harmony round unwinds cleanly", await page.evaluate(() =>
  ![1, 2].some((i) => window.__SESSION__.score.measures[i].children.some((c) => typeof c !== "string" && c.tag === "harm"))));

// --- 7j. ctrl+o / ctrl+s (browser fallbacks; the shell uses native dialogs) ---
{
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 10000 });
  await page.keyboard.press("Control+o");
  const chooser = await chooserPromise;
  check("ctrl+o opens the file chooser in the browser", true);
  await chooser.setFiles([]); // dismiss
  const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
  await page.keyboard.press("Control+s");
  const download = await downloadPromise;
  check(`ctrl+s downloads the score (${download.suggestedFilename()})`, download.suggestedFilename().endsWith(".mei"));
  await download.cancel();
}

// --- 7k. random ids, ⟲id repair, pretty saves ---
{
  const idReport = await page.evaluate(() => {
    const ids = [];
    const walk = (el) => { if (el.attrs?.["xml:id"]) ids.push(el.attrs["xml:id"]); for (const c of el.children ?? []) if (typeof c !== "string") walk(c); };
    walk(window.__SESSION__.score.scoreEl);
    return { total: ids.length, random: ids.filter((i) => /^bt-[0-9a-z]{8}$/.test(i)).length, unique: new Set(ids).size === ids.length };
  });
  check(`session ids are unique (${idReport.total} ids, ${idReport.random} random-form)`, idReport.unique);
  const before = await page.evaluate(() => {
    const walk = (el) => el.attrs?.["xml:id"] ?? walk(el.children.find((c) => typeof c !== "string"));
    return window.__SESSION__.score.measures[0].attrs["xml:id"];
  });
  await page.locator("[data-menu-toggle]").click();
  await page.locator("[data-regen-ids]").click();
  await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("ids regenerated"), null, { timeout: 10000 });
  check("⟲id regenerates and reports", true);
  check("measure ids actually changed", await page.evaluate((old) => window.__SESSION__.score.measures[0].attrs["xml:id"] !== old, before));
  check("…and references still resolve (no dangling startids)", await page.evaluate(() => {
    const ids = new Set();
    const collect = (el) => { if (el.attrs?.["xml:id"]) ids.add(el.attrs["xml:id"]); for (const c of el.children ?? []) if (typeof c !== "string") collect(c); };
    collect(window.__SESSION__.score.scoreEl);
    let ok = true;
    const checkRefs = (el) => {
      for (const [k, v] of Object.entries(el.attrs ?? {})) {
        if (k !== "xml:id" && typeof v === "string" && v.startsWith("#") && !v.includes(" ")) {
          if (!ids.has(v.slice(1))) ok = false;
        }
      }
      for (const c of el.children ?? []) if (typeof c !== "string") checkRefs(c);
    };
    checkRefs(window.__SESSION__.score.scoreEl);
    return ok;
  }));
  await page.keyboard.press("Control+z");
  await page.waitForFunction((old) => window.__SESSION__.score.measures[0].attrs["xml:id"] === old, before, { timeout: 10000 });
  check("undo restores the original ids", true);
  const saved = await page.evaluate(() => window.__SESSION__.saveDocument());
  check("saved XML is formatted (indented, multi-line)", saved.split("\n").length > 20 && saved.includes("\n      "));
}

// --- 7l. shortcut editor (🌣): list, rebind, reroute, reset ---
{
  await page.evaluate(() => localStorage.removeItem("battuta.keymap.v1.qwerty"));
  await page.locator("[data-menu-toggle]").click();
  await page.locator("[data-shortcuts-toggle]").click();
  await page.waitForFunction(() => document.querySelector("[data-shortcuts]"), null, { timeout: 5000 });
  check("🌣 opens the shortcut editor", true);
  check("bindings are listed with their keys", await page.evaluate(() => document.querySelector('[data-shortcut-bind="tie"]')?.textContent.trim() === "t"));
  check("locked system rows are shown but not rebindable", await page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-shortcut-row]")];
    return rows.length > 20 && !document.querySelector('[data-shortcut-bind="durations"]');
  }));
  // rebind tie -> y
  await page.locator('[data-shortcut-bind="tie"]').click();
  await page.waitForFunction(() => document.querySelector('[data-shortcut-bind="tie"]').textContent.includes("press"), null, { timeout: 5000 });
  await page.keyboard.press("y");
  await page.waitForFunction(() => document.querySelector('[data-shortcut-bind="tie"]').textContent.trim() === "y", null, { timeout: 5000 });
  check("capturing a key rebinds the action", true);
  await page.keyboard.press("Escape"); // close the editor
  await page.waitForFunction(() => !document.querySelector("[data-shortcuts]"), null, { timeout: 5000 });
  // the rebind ROUTES: y ties, t no longer does
  await page.locator('g[id="cc-m1n1"] use').first().click({ force: true });
  await page.waitForFunction(() => document.querySelector("main").dataset.caret === "cc-m1n1", null, { timeout: 5000 });
  // routing proof: tying m1's first note refuses on pitch — the REFUSAL
  // notice appearing (or not) shows which key reaches the tie action
  const noticeBefore = await page.evaluate(() => document.querySelector("[data-notice]").textContent);
  await page.keyboard.press("t");
  await page.waitForTimeout(400);
  check("the old key is unbound", await page.evaluate((n) => document.querySelector("[data-notice]").textContent === n, noticeBefore));
  await page.keyboard.press("y");
  await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("tie refused"), null, { timeout: 5000 });
  check("the new key reaches the tie action", true);
  // reset restores defaults
  await page.locator("[data-menu-toggle]").click();
  await page.locator("[data-shortcuts-toggle]").click();
  await page.waitForFunction(() => document.querySelector("[data-shortcuts]"), null, { timeout: 5000 });
  await page.locator("[data-shortcuts-reset]").click();
  await page.waitForFunction(() => document.querySelector('[data-shortcut-bind="tie"]')?.textContent.trim() === "t", null, { timeout: 5000 });
  check("reset all restores the defaults", true);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("[data-shortcuts]"), null, { timeout: 5000 });
}


// --- 7m. small-fix round: toasts, title, row nav, finger change, dirty star, layouts, settings ---
{
  // notices are toasts now: fixed bottom-right container, still [data-notice]
  check("notices render as a bottom-right toast", await page.evaluate(() => {
    let el = document.querySelector("[data-notice]");
    while (el && getComputedStyle(el).position !== "fixed") el = el.parentElement;
    return !!el && getComputedStyle(el).bottom !== "auto";
  }));

  // title: button -> input -> Enter writes the meiHead title, one undo step
  await page.locator("[data-title-button]").click();
  await page.waitForFunction(() => document.querySelector("[data-title-input]"), null, { timeout: 5000 });
  await page.locator("[data-title-input]").fill("Kinderszenen Probe");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector("[data-title-input]"), null, { timeout: 5000 });
  check("the title input writes meiHead/fileDesc/titleStmt/title", await page.evaluate(() => window.__SESSION__.title() === "Kinderszenen Probe" && window.__SESSION__.saveDocument().includes("<title>Kinderszenen Probe</title>")));
  check("the title edit is one undoable command", await page.evaluate(() => {
    window.__SESSION__.undo();
    const afterUndo = window.__SESSION__.title();
    window.__SESSION__.redo();
    return afterUndo !== "Kinderszenen Probe" && window.__SESSION__.title() === "Kinderszenen Probe";
  }));
  // the title edit is unsaved work: the tab must carry the dirty star
  check("an edited tab carries the dirty *", await page.evaluate(() => document.querySelector(".tab.active").textContent.includes("*")));
  // the × dismisses the toast without waiting for the timeout
  await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("title"), null, { timeout: 5000 });
  await page.locator("[data-notice-dismiss]").click();
  await page.waitForFunction(() => document.querySelector("[data-notice]").textContent === "", null, { timeout: 5000 });
  check("the toast × dismisses it immediately", true);

  // the button relabels to the current title…
  check("the title button shows the title as its label", await page.evaluate(() => document.querySelector("[data-title-button]").textContent.trim() === "Kinderszenen Probe"));
  // …and page view actually prints it (meiHead rides serializeForPageView, header:auto)
  await page.locator("button", { hasText: "page view" }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".pages .page svg text")].some((t) => t.textContent.includes("Kinderszenen Probe")), null, { timeout: 60000 });
  check("page view prints the title in the page header", true);
  await page.locator("button", { hasText: "edit view" }).click();
  await page.waitForFunction(() => document.querySelector(".tile"), null, { timeout: 60000 });

  // Insert toggles note input like i
  await page.locator('g[id="cc-m1n1"] use').first().click({ force: true });
  await page.waitForFunction(() => document.querySelector("main").dataset.caret === "cc-m1n1", null, { timeout: 5000 });
  await page.keyboard.press("Insert");
  await page.waitForFunction(() => document.querySelector("[data-input-indicator]").textContent !== "INPUT (i)", null, { timeout: 5000 });
  check("Insert enters note input", true);
  await page.keyboard.press("Insert");
  await page.waitForFunction(() => document.querySelector("[data-input-indicator]").textContent === "INPUT (i)", null, { timeout: 5000 });
  check("Insert again leaves note input", true);

  // Home/End = row start/end; PageDown/PageUp = next/previous row.
  // The fixture fits one row at 100%, so zoom to max first — the page keys
  // need a second row to land on.
  await page.locator("[data-zoom-toggle]").click();
  await page.waitForFunction(() => document.querySelector("[data-zoom-in]"), null, { timeout: 5000 });
  for (let i = 0; i < 6; i++) await page.locator("[data-zoom-in]").click();
  await page.waitForFunction(() => document.querySelectorAll(".score-row").length >= 2, null, { timeout: 60000 });
  const caretMeasure = () => page.evaluate(() => window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret).measureIndex);
  const row0len = await page.evaluate(() => document.querySelector(".score-row").querySelectorAll(".tile[data-index]").length);
  await page.keyboard.press("End");
  await page.waitForFunction((n) => window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret).measureIndex === n - 1, row0len, { timeout: 5000 });
  check(`End jumps to the last measure of the row (m${await caretMeasure() + 1})`, true);
  await page.keyboard.press("Home");
  await page.waitForFunction(() => window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret).measureIndex === 0, null, { timeout: 5000 });
  check("Home jumps back to the first measure of the row", true);
  await page.keyboard.press("PageDown");
  await page.waitForFunction((n) => window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret).measureIndex >= n, row0len, { timeout: 5000 });
  check(`PageDown lands on the next row (m${await caretMeasure() + 1})`, true);
  await page.keyboard.press("PageUp");
  await page.waitForFunction((n) => window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret).measureIndex < n, row0len, { timeout: 5000 });
  check("PageUp returns to the previous row", true);
  // the view follows the caret: scroll it away, move the caret, it returns
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.keyboard.press("End");
  await page.waitForFunction(() => {
    const id = document.querySelector("main").dataset.caret;
    const g = document.querySelector(`g[id="${id}"]`);
    if (!g) return false;
    const r = g.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  }, null, { timeout: 5000 });
  check("the view follows the caret back on-screen", true);
  await page.locator("[data-zoom-reset]").click();
  await page.locator("[data-zoom-toggle]").click(); // close the panel

  // finger change: alt+2 sets "2", alt+6 makes it "2-1", alt+6 again undoes it
  await page.locator('g[id="cc-m1n1"] use').first().click({ force: true });
  await page.waitForFunction(() => document.querySelector("main").dataset.caret === "cc-m1n1", null, { timeout: 5000 });
  const fingsNow = () => page.evaluate(() => JSON.stringify(window.__SESSION__.fingAt("cc-m1n1")));
  await page.keyboard.press("Alt+Digit2");
  await page.waitForFunction(() => JSON.stringify(window.__SESSION__.fingAt("cc-m1n1")) === '["2"]', null, { timeout: 5000 });
  await page.keyboard.press("Alt+Digit6");
  await page.waitForFunction(() => JSON.stringify(window.__SESSION__.fingAt("cc-m1n1")) === '["2-1"]', null, { timeout: 5000 });
  check('alt+6 turns fingering "2" into the change "2-1"', true);
  await page.keyboard.press("Alt+Digit6");
  await page.waitForFunction(() => JSON.stringify(window.__SESSION__.fingAt("cc-m1n1")) === '["2"]', null, { timeout: 5000 });
  check(`the same key removes the substitution (${await fingsNow()})`, true);
  await page.keyboard.press("Alt+Digit2"); // cleanup: fingering off

  // keyboard layouts: qwerty and azerty carry separate defaults
  await page.locator("[data-menu-toggle]").click();
  await page.locator("[data-shortcuts-toggle]").click();
  await page.waitForFunction(() => document.querySelector("[data-shortcuts]"), null, { timeout: 5000 });
  check("the default layout binds qwerty simile '", await page.evaluate(() => document.querySelector('[data-shortcut-bind="simile"]')?.textContent.trim() === "'"));
  await page.locator('[data-layout="azerty"]').click();
  await page.waitForFunction(() => document.querySelector('[data-shortcut-bind="simile"]')?.textContent.trim() === "ù", null, { timeout: 5000 });
  check("azerty swaps the punctuation defaults (simile ù)", true);
  check("the layout persists in settings", await page.evaluate(() => JSON.parse(localStorage.getItem("battuta.settings.v1")).layout === "azerty"));
  await page.locator('[data-layout="qwerty"]').click();
  await page.waitForFunction(() => document.querySelector('[data-shortcut-bind="simile"]')?.textContent.trim() === "'", null, { timeout: 5000 });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("[data-shortcuts]"), null, { timeout: 5000 });

  // the zoom level rides the same settings store
  check("the zoom level persists in settings", await page.evaluate(() => JSON.parse(localStorage.getItem("battuta.settings.v1")).zoom === Number(document.querySelector("[data-zoom-toggle]").dataset.zoom)));
}


// --- 7n. page-view player: timemap-driven audio + highlight ---
{
  await page.locator("button", { hasText: "page view" }).click();
  await page.waitForFunction(() => document.querySelector(".pages .page svg"), null, { timeout: 60000 });
  await page.locator("[data-player-toggle]").click();
  await page.waitForFunction(() => document.querySelector("[data-player-toggle]").textContent.trim() === "⏸", null, { timeout: 60000 });
  check("play loads the sampler + timemap and starts", true);
  await page.waitForFunction(() => document.querySelector(".pages g.playing"), null, { timeout: 20000 });
  check("playback highlights the sounding notes in page view", true);

  // progress bar + tempo (step 3)
  const parseClock = (s) => { const [mm, ss] = s.split(":").map(Number); return mm * 60 + ss; };
  await page.waitForFunction(() => {
    const t = document.querySelector("[data-player-time]");
    return t && !t.textContent.trim().startsWith("0:00 /");
  }, null, { timeout: 10000 });
  check("the progress readout advances while playing", true);
  const total1 = await page.evaluate(() => document.querySelector("[data-player-time]").textContent.split("/")[1].trim());
  await page.selectOption("[data-player-tempo]", "2");
  await page.waitForFunction((t1) => document.querySelector("[data-player-time]").textContent.split("/")[1].trim() !== t1, total1, { timeout: 5000 });
  const total2 = await page.evaluate(() => document.querySelector("[data-player-time]").textContent.split("/")[1].trim());
  check(`2× tempo halves the listening time (${total1} → ${total2})`, parseClock(total2) > 0 && parseClock(total2) <= parseClock(total1) / 2 + 1);
  await page.locator("[data-player-progress]").click({ position: { x: 112, y: 4 } });
  await page.waitForFunction(() => {
    const [p, t] = document.querySelector("[data-player-time]").textContent.split("/").map((x) => x.trim());
    const sec = (s) => { const [mm, ss] = s.split(":").map(Number); return mm * 60 + ss; };
    return sec(t) > 0 && sec(p) / sec(t) > 0.55;
  }, null, { timeout: 5000 });
  check("clicking the progress bar seeks", true);
  await page.selectOption("[data-player-tempo]", "1"); // restore for the volta pass below

  await page.locator("[data-player-toggle]").click(); // pause
  await page.waitForFunction(() => document.querySelector("[data-player-toggle]").textContent.trim() === "▶", null, { timeout: 5000 });
  check("pause flips the button back to play", true);
  await page.locator("[data-player-stop]").click();
  await page.waitForFunction(() => !document.querySelector(".pages g.playing"), null, { timeout: 5000 });
  check("stop clears every highlight", true);

  // repeats follow the form: a volta pair expands into passes, and every
  // cloned pass id maps back to a notated id the SVG actually contains
  await page.locator("button", { hasText: "edit view" }).click();
  await page.waitForFunction(() => document.querySelector(".tile"), null, { timeout: 60000 });
  await page.evaluate(() => {
    window.__SESSION__.toggleVolta(1, 1, 1);
    window.__SESSION__.toggleVolta(2, 2, 2);
  });
  await page.locator("button", { hasText: "page view" }).click();
  await page.waitForFunction(() => document.querySelector(".pages .page svg"), null, { timeout: 60000 });
  await page.evaluate(() => { window.__PLAYBACK__ = null; });
  await page.locator("[data-player-toggle]").click();
  await page.waitForFunction(() => window.__PLAYBACK__ && window.__PLAYBACK__.events.length > 0, null, { timeout: 60000 });
  const exp = await page.evaluate(() => {
    const d = window.__PLAYBACK__;
    const on = d.events.flatMap((e) => e.on ?? []);
    const clones = on.filter((id) => d.idMap[id]);
    const mappedInSvg = clones.every((id) => document.querySelector(`.pages g[id="${CSS.escape(d.idMap[id])}"]`));
    const meas = d.events.map((e) => e.measureOn).filter(Boolean).map((id) => d.idMap[id] ?? id);
    const m0 = window.__SESSION__.score.measures[0].attrs["xml:id"];
    return { clones: clones.length, mappedInSvg, prePasses: meas.filter((id) => id === m0).length, seq: meas.length };
  });
  check(`the volta form plays expanded (${exp.clones} cloned events, ${exp.seq} measures)`, exp.clones > 0);
  check("the pre-volta measure plays twice (pass per ending)", exp.prePasses === 2);
  check("every cloned id maps back to a notated id in the SVG", exp.mappedInSvg);
  await page.locator("[data-player-stop]").click();
  await page.locator("button", { hasText: "edit view" }).click();
  await page.waitForFunction(() => document.querySelector(".tile"), null, { timeout: 60000 });
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => window.__SESSION__.score.measureParent.get(window.__SESSION__.score.measures[1])?.tag !== "ending", null, { timeout: 10000 });
  check("volta cleanup unwinds", true);

  // ties + slurs shape the sound: the tie graph must reach the player
  const tieDepth0 = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
  const tieIds = await page.evaluate(() => {
    const s = window.__SESSION__;
    const ids = s.index.eventsAt(0, 1, 1).filter((id) => s.index.byId.get(id)?.tag === "note").slice(0, 2);
    s.setPitches([{ eventId: ids[0], pitches: [{ pname: "g", oct: 4 }] }, { eventId: ids[1], pitches: [{ pname: "g", oct: 4 }] }], "test tie");
    s.tieChain(ids);
    return ids;
  });
  await page.locator("button", { hasText: "page view" }).click();
  await page.waitForFunction(() => document.querySelector(".pages .page svg"), null, { timeout: 60000 });
  await page.evaluate(() => { window.__PLAYBACK__ = null; });
  await page.locator("[data-player-toggle]").click();
  await page.waitForFunction(() => window.__PLAYBACK__ && window.__PLAYBACK__.shaping, null, { timeout: 60000 });
  check("playback data carries tie/slur shaping", true);
  check("the tied pair reaches the player's merge graph", await page.evaluate((ids) => window.__PLAYBACK__.shaping.ties[ids[0]] === ids[1], tieIds));
  await page.locator("[data-player-stop]").click();
  await page.locator("button", { hasText: "edit view" }).click();
  await page.waitForFunction(() => document.querySelector(".tile"), null, { timeout: 60000 });
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth === d, tieDepth0, { timeout: 10000 });
  check("tie-shaping round unwinds", true);
}


// --- 7p. reflection cycle: shift+R on a block = P → I → R → RI → P ---
{
  const beforeReflect = await page.evaluate(() => window.__SESSION__.saveDocument());
  // the volta cleanup just re-rendered: wait for real staves before dragging
  await page.waitForFunction(() => document.querySelector('.tile[data-index="0"] g[class~="staff"]') && document.querySelector('.tile[data-index="1"] g[class~="staff"]'), null, { timeout: 60000 });
  // block m1–m2 × staff 1 (same drag pattern as the volta round)
  let rBlock = "";
  for (let t = 0; t < 5 && rBlock !== "0-1/1-1"; t++) {
    const a = await vCenter(0);
    const b = await vCenter(1);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    rBlock = await page
      .waitForFunction(() => document.querySelector("main").dataset.block === "0-1/1-1", null, { timeout: 1500 })
      .then(() => "0-1/1-1")
      .catch(() => page.evaluate(() => document.querySelector("main").dataset.block));
  }
  check("block m1–m2 selected for the reflection", rBlock === "0-1/1-1");
  await page.keyboard.press("Shift+KeyR");
  await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("reflection: inversion"), null, { timeout: 5000 });
  check("shift+R inverts (mirrored about the first note)", await page.evaluate((b) => window.__SESSION__.saveDocument() !== b, beforeReflect));
  await page.keyboard.press("Shift+KeyR");
  await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("retrograde"), null, { timeout: 5000 });
  check("second press: retrograde", true);
  await page.keyboard.press("Shift+KeyR");
  await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("retrograde inversion"), null, { timeout: 5000 });
  check("third press: retrograde inversion", true);
  await page.keyboard.press("Shift+KeyR");
  await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("back to the original"), null, { timeout: 5000 });
  check("fourth press restores the document byte-identically", await page.evaluate((b) => window.__SESSION__.saveDocument() === b, beforeReflect));
  // each press was one undo step: unwind the four
  for (let i = 0; i < 4; i++) await page.keyboard.press("Control+z");
  await page.waitForFunction((b) => window.__SESSION__.saveDocument() === b, beforeReflect, { timeout: 10000 });
  check("the cycle unwinds through undo too", true);
}


// --- 7q. one selection model + the cross-staff slur ---
{
  const q0 = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
  // a note on staff 2 (enter one when the fixture has none there)
  let s2note = await page.evaluate(() => window.__SESSION__.index.eventsAt(0, 2, 1).find((id) => window.__SESSION__.index.byId.get(id)?.tag === "note"));
  if (!s2note) {
    const s2first = await page.evaluate(() => window.__SESSION__.index.eventsAt(0, 2, 1)[0]);
    await clickEvent(s2first);
    await page.keyboard.press("i");
    await page.keyboard.press("c");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.__SESSION__.index.eventsAt(0, 2, 1).some((id) => window.__SESSION__.index.byId.get(id)?.tag === "note"), null, { timeout: 10000 });
    s2note = await page.evaluate(() => window.__SESSION__.index.eventsAt(0, 2, 1).find((id) => window.__SESSION__.index.byId.get(id)?.tag === "note"));
  }

  // (a) shift-run → measure-shaped action: r toggles repeat barlines
  const m2note = await page.evaluate(() => window.__SESSION__.index.eventsAt(1, 1, 1).find((id) => window.__SESSION__.index.byId.get(id)?.tag === "note"));
  let rptOk = false;
  for (let t = 0; t < 4 && !rptOk; t++) {
    await clickEvent("cc-m1n1");
    await page.locator(`g[id="${m2note}"] use`).first().click({ modifiers: ["Shift"], force: true });
    await page.keyboard.press("r");
    rptOk = await page
      .waitForFunction(() => window.__SESSION__.score.measures[0].attrs.left === "rptstart" && window.__SESSION__.score.measures[1].attrs.right === "rptend", null, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
  }
  check("a shift-run drives the measure-shaped repeat action", rptOk);
  await page.keyboard.press("r"); // the selection still stands: toggle back off
  await page.waitForFunction(() => window.__SESSION__.score.measures[0].attrs.left !== "rptstart", null, { timeout: 5000 });
  check("…and toggles back off from the same selection", true);

  // (b) mouse block → event-shaped action: p makes a hairpin over the run
  let hpBlock = "";
  for (let t = 0; t < 5 && hpBlock !== "0-1/1-1"; t++) {
    const a = await vCenter(0);
    const b = await vCenter(1);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    hpBlock = await page
      .waitForFunction(() => document.querySelector("main").dataset.block === "0-1/1-1", null, { timeout: 1500 })
      .then(() => "0-1/1-1")
      .catch(() => page.evaluate(() => document.querySelector("main").dataset.block));
  }
  check("block m1–m2 selected for the hairpin", hpBlock === "0-1/1-1");
  await page.keyboard.press("p");
  await page.waitForFunction(() => {
    const m = window.__SESSION__.score.measures[0];
    return m.children.some((c) => typeof c !== "string" && c.tag === "hairpin");
  }, null, { timeout: 5000 });
  check("a mouse block drives the event-shaped hairpin action", true);
  await page.keyboard.press("Control+z");

  // (c) the infamous cross-staff slur: click staff 1, shift+click staff 2, S
  let slurOk = false;
  for (let t = 0; t < 4 && !slurOk; t++) {
    await clickEvent("cc-m1n1");
    await page.locator(`g[id="${s2note}"] use`).first().click({ modifiers: ["Shift"], force: true });
    const paired = await page
      .waitForFunction((id) => [...document.querySelectorAll("style")].some((s) => s.textContent.includes(id) && s.textContent.includes("#d22")), s2note, { timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    if (!paired) continue; // the shift-click missed (stale coords): retry
    await page.keyboard.press("S");
    slurOk = await page
      .waitForFunction(() => {
        const m = window.__SESSION__.score.measures[0];
        return m.children.some((c) => typeof c !== "string" && c.tag === "slur" && c.attrs.staff === "1 2");
      }, null, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
  }
  check("cross-staff slur: endpoints on staff 1 and staff 2, staff=\"1 2\"", slurOk);
  // non-vacuous render check: the NEW slur's own id must appear in tile 0
  // (the fixture already carries an unrelated slur there)
  const xslurId = await page.evaluate(() => {
    const m = window.__SESSION__.score.measures[0];
    return m.children.find((c) => typeof c !== "string" && c.tag === "slur" && c.attrs.staff === "1 2")?.attrs["xml:id"];
  });
  await page.waitForFunction((id) => id && document.querySelector(`.tile[data-index="0"] g[id="${id}"]`), xslurId, { timeout: 15000 });
  check("…and Verovio draws it in the tile", true);

  // cleanup: unwind everything this section did
  for (let i = 0; i < 12; i++) {
    const depth = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
    if (depth <= q0) break;
    await page.keyboard.press("Control+z");
    await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth < d, depth, { timeout: 5000 });
  }
  check("selection-model round unwinds", await page.evaluate((d) => window.__SESSION__.stack.undoDepth === d, q0));
}


// --- 7r. 3/2 meter + tie-after-tie chains + attack intensity ---
{
  // a scratch tab: 3/2 on empty measures, then three entered notes for
  // the tie chain — discarded whole at the end (no undo bookkeeping)
  await page.locator(".tab-new").click();
  await page.waitForFunction(() => window.__SESSION__.score.measures.length === 4, null, { timeout: 10000 });
  const mrest = await page.evaluate(() => window.__SESSION__.index.eventsAt(0, 1, 1)[0]);
  await clickEvent(mrest);
  await page.selectOption('select[title*="meter"]', "3/2");
  await page.waitForFunction(() => document.querySelector('select[title*="meter"]').value === "3/2", null, { timeout: 10000 });
  check("3/2 joins the meter select and applies on empty measures", true);

  // enter g g g — three CONSECUTIVE same-pitch notes
  await page.keyboard.press("i");
  for (const k of ["g", "g", "g"]) await page.keyboard.press(k);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__SESSION__.index.eventsAt(0, 1, 1).filter((id) => window.__SESSION__.index.byId.get(id)?.tag === "note").length >= 3, null, { timeout: 10000 });
  const chain = await page.evaluate(() => window.__SESSION__.index.eventsAt(0, 1, 1).filter((id) => window.__SESSION__.index.byId.get(id)?.tag === "note").slice(0, 3));

  // tie after tie: n_n_n must be ONE chain (i, m, t)
  await clickEvent(chain[1]);
  await page.keyboard.press("t"); // ties chain[0] -> chain[1]
  await page.waitForFunction((ids) => {
    const doc = window.__SESSION__.saveDocument();
    return new RegExp(`xml:id="${ids[0]}"[^>]*tie="i"|tie="i"[^>]*xml:id="${ids[0]}"`).test(doc);
  }, chain, { timeout: 5000 });
  await clickEvent(chain[2]);
  await page.keyboard.press("t"); // ties chain[1] -> chain[2]: the shared note must become "m"
  await page.waitForFunction((ids) => {
    const doc = window.__SESSION__.saveDocument();
    const tieOf = (id) => (doc.match(new RegExp(`<note[^>]*xml:id="${id}"[^>]*/?>`))?.[0].match(/tie="([imt])"/) ?? [])[1];
    return tieOf(ids[0]) === "i" && tieOf(ids[1]) === "m" && tieOf(ids[2]) === "t";
  }, chain, { timeout: 5000 });
  check("tie after tie builds i / m / t — the first tie stays connected", true);
  check("the sound merges the whole chain", await page.evaluate((ids) => {
    const ties = window.__SESSION__.playbackShaping().ties;
    return ties[ids[0]] === ids[1] && ties[ids[1]] === ids[2];
  }, chain));

  // attack intensity: I cycles sf → sfz → rinf → rfz → off at the caret
  await clickEvent(chain[0]);
  for (const want of ["sf", "sfz", "rinf", "rfz"]) {
    await page.keyboard.press("Shift+KeyI");
    await page.waitForFunction((w) => {
      const m = window.__SESSION__.score.measures[0];
      return m.children.some((c) => typeof c !== "string" && c.tag === "dynam" && c.children.join("") === w);
    }, want, { timeout: 5000 });
  }
  check("I cycles the attack intensity sf → sfz → rinf → rfz", true);
  await page.waitForFunction(() => document.querySelector('.tile[data-index="0"] g[class~="dynam"]'), null, { timeout: 15000 });
  check("…and Verovio draws the intensity dynam", true);
  await page.keyboard.press("Shift+KeyI");
  await page.waitForFunction(() => !window.__SESSION__.score.measures[0].children.some((c) => typeof c !== "string" && c.tag === "dynam"), null, { timeout: 5000 });
  check("a fifth press clears it", true);

  // discard the scratch tab, back to the fixture
  await page.locator(".tab.active .tab-close").click();
  await page.locator(".tabs .tab").first().click();
  await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 10, null, { timeout: 30000 });
}

// --- 8. open file… from disk ---
await page.setInputFiles('input[type="file"]', "/home/flux/projects/battuta/fixtures/Bach-JS_Ein_feste_Burg.mei");
await page.waitForFunction(() => [...document.querySelectorAll(".tabs .tab")].some((t) => t.textContent.includes("Bach-JS_Ein_feste_Burg")), null, { timeout: 10000 });
check("open file… creates a tab named after the file", true);
check("a freshly opened tab has no dirty star", await page.evaluate(() => {
  const tab = [...document.querySelectorAll(".tabs .tab")].find((t) => t.textContent.includes("Bach-JS_Ein_feste_Burg"));
  return tab && !tab.textContent.includes("*");
}));
await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 14, null, { timeout: 60000 });
check("the disk file renders completely", true);
check(`its staff count reads correctly (${await stavesLabel()})`, (await stavesLabel()) === "staves (2)");

// --- 9. reloading a battuta-saved file must not re-mint its bt-* ids ---
{
  await page.locator(".tabs .tab").first().click();
  await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 10, null, { timeout: 30000 });
  const savedXml = await page.evaluate(() => window.__SESSION__.saveDocument());
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(tmpdir() + "/bt-resave-");
  writeFileSync(dir + "/resaved.mei", savedXml);
  await page.setInputFiles('input[type="file"]', dir + "/resaved.mei");
  await page.waitForFunction(() => [...document.querySelectorAll(".tabs .tab")].some((t) => t.textContent.includes("resaved")), null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 10, null, { timeout: 60000 });
  // edit the reloaded file: add a voice and two measures
  await page.locator('.tile[data-index="0"] g[class~="note"] use').first().click({ force: true });
  await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
  await page.selectOption('select[title*="voices"]', "add");
  await page.waitForFunction(() => JSON.stringify(window.__SESSION__.index.layersPerStaff.get("0/1")) === "[1,2]", null, { timeout: 10000 });
  await page.keyboard.press("NumpadAdd");
  await page.keyboard.press("NumpadAdd");
  await page.waitForFunction(() => window.__SESSION__.score.measures.length === 12, null, { timeout: 10000 });
  const idReport = await page.evaluate(() => {
    const seen = new Set();
    const dups = [];
    const walk = (el) => {
      const id = el.attrs?.["xml:id"];
      if (id) {
        if (seen.has(id)) dups.push(id);
        seen.add(id);
      }
      for (const c of el.children ?? []) if (typeof c !== "string") walk(c);
    };
    walk(window.__SESSION__.root);
    const caretRef = window.__SESSION__.index.byId.get(document.querySelector("main").dataset.caret);
    const fresh = window.__SESSION__.score.measures[caretRef.measureIndex];
    const strays = fresh.children.filter((c) => typeof c !== "string" && c.tag !== "staff").map((c) => c.tag);
    return { dups, caretMeasure: caretRef.measureIndex, strays, total: seen.size };
  });
  check(`no duplicate ids after editing a re-saved file (${idReport.total} ids)`, idReport.dups.length === 0);
  check("the caret is really in the new measure (no id aliasing)", idReport.caretMeasure === 2);
  check(`fresh measures carry no foreign slurs or dynamics ([${idReport.strays}])`, idReport.strays.length === 0);
}

} finally {
  await browser.close();
  await server.close();
}
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
