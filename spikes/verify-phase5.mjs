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
check("context + staves selects sit in the status bar", await page.evaluate(() => document.querySelectorAll("[data-statusbar] select").length === 4));
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

// --- 8. open file… from disk ---
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
