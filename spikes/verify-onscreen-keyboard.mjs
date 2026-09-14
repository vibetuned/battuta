/**
 * On-screen keyboard end-to-end check — the panel as an INPUT SURFACE.
 *
 * Written before slice 4's extraction, against the in-App panel, so the
 * move into a plugin (slice 4, still to come) has something to be
 * behaviour-neutral against (PLANNING.md: "No committed e2e drives the
 * panel today: the slice adds one first"). Everything here is driven by
 * TAPPING the panel — never by the physical keyboard — so it fails if the
 * panel ever stops reaching the one keydown handler:
 *
 *  1. the 🎹 toggle opens and closes the panel, and the choice persists
 *  2. a tapped ACTION key does what the physical key does (input mode,
 *     durations through the digit pad, undo through the ctrl chord)
 *  3. a tapped PIANO key reaches the entry path and writes a note
 *  4. multi-touch: two held keys enter a chord
 *  5. the panel projects the UNION keymap — a binding contributed by a
 *     plugin (the reflection cycle) captions the shifted rest key
 *  6. latches are one-shot and relabel live
 *  7. the octave rail moves the piano's range
 *
 * Run: node spikes/verify-onscreen-keyboard.mjs
 */
import { createServer } from "vite";
import { chromium } from "playwright";
import { clickFirstNote } from "./lib/e2e.mjs";

const ROOT = process.env.BATTUTA_ROOT ?? "/home/flux/projects/battuta";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

const server = await createServer({
  configFile: `${ROOT}/apps/editor/vite.config.ts`,
  root: `${ROOT}/apps/editor`,
  server: { port: 0 },
  logLevel: "warn",
});
await server.listen();
const browser = await chromium.launch({ ...(CHROME === "bundled" ? {} : { executablePath: CHROME }), headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(server.resolvedUrls.local[0] + "?pool=2");
try {
  await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 10, null, { timeout: 60000 });

  const panelOpen = () => page.evaluate(() => Boolean(document.querySelector("[data-vkeys]")));
  const entryMode = () => page.evaluate(() => document.querySelector("main").dataset.entry);
  const undoDepth = () => page.evaluate(() => window.__SESSION__.stack.undoDepth);
  const caretEvent = () =>
    page.evaluate(() => {
      const id = document.querySelector("main").dataset.caret;
      const ref = id ? window.__SESSION__.index.byId.get(id) : null;
      return ref ? { id, tag: ref.tag } : null;
    });
  /**
   * Pitches of the caret's measure/staff/layer, as "pname+oct" per event
   * (EventRef carries no element, so the measure tree is walked for one).
   */
  const layerPitches = () =>
    page.evaluate(() => {
      const s = window.__SESSION__;
      const id = document.querySelector("main").dataset.caret;
      const ref = id ? s.index.byId.get(id) : null;
      if (!ref) return null;
      const byId = new Map();
      const collect = (el) => {
        if (el.attrs?.["xml:id"]) byId.set(el.attrs["xml:id"], el);
        for (const c of el.children ?? []) if (typeof c !== "string") collect(c);
      };
      collect(s.score.measures[ref.measureIndex]);
      return s.index.eventsAt(ref.measureIndex, ref.staffN, ref.layerN).map((eid) => {
        const el = byId.get(eid);
        if (!el) return "?";
        const notes = [];
        const walk = (e) => {
          if (e.tag === "note") notes.push(`${e.attrs.pname}${e.attrs.oct}`);
          for (const c of e.children ?? []) if (typeof c !== "string") walk(c);
        };
        walk(el);
        return notes.length ? notes.join("+") : el.tag;
      });
    });
  const tap = (sel) => page.locator(sel).first().click({ force: true });
  // Since slice 4b the 🎹 is declared in the plugin's MANIFEST and rendered
  // by the host before the plugin's code loads, so it carries the generic
  // declared-slot-item hook rather than an App-specific one. Tapping it is
  // what activates the plugin — which is the point of the test below.
  // DESIGN HOOK 1 of 2 (the brief allows exactly these two to move). Two
  // selectors, one button: the host's declared face before the plugin's
  // code loads, the plugin's own live face (which dims when the panel is
  // down) once it is active.
  const TOGGLE = '[data-slot-command="battuta.onscreen-keyboard.toggle"], [data-vkeys-toggle]';
  /** A piano key press/release, as a real pointer would (the panel listens on pointer events). */
  const pianoTap = async (midi, holdWith = []) => {
    const box = async (m) => (await page.locator(`[data-vk-note="${m}"]`).first().boundingBox());
    const b = await box(midi);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height - 6);
    await page.mouse.down();
    for (const m of holdWith) {
      // a second finger: the panel tracks held notes per key, so a
      // pointerdown on another key while this one is down is a chord
      await page.locator(`[data-vk-note="${m}"]`).first().dispatchEvent("pointerdown", { isPrimary: false });
    }
    for (const m of holdWith) await page.locator(`[data-vk-note="${m}"]`).first().dispatchEvent("pointerup", { isPrimary: false });
    await page.mouse.up();
  };

  // --- 1. the toggle -------------------------------------------------------
  check("the panel starts closed on a fine pointer", !(await panelOpen()));
  await tap(TOGGLE);
  await page.waitForFunction(() => document.querySelector("[data-vkeys]"), null, { timeout: 5000 });
  check("🎹 opens the panel", await panelOpen());
  // Where the panel is mounted is the design under test in slice 4 (the
  // in-App panel today; a host panel area for a plugin) — so this only
  // asserts that ONE panel exists, wherever the tree puts it.
  check("…exactly one panel is mounted", (await page.evaluate(() => document.querySelectorAll("[data-vkeys]").length)) === 1);
  check("the panel carries a piano and shortcut groups", await page.evaluate(() => Boolean(document.querySelector("[data-vk-piano]")) && document.querySelectorAll("[data-vk-group]").length >= 4));
  // The open flag: since slice 4b it is the plugin's own settings namespace
  // inside the editor's blob (the legacy top-level `vkeys` is migrated into
  // it once, by settings.ts). DESIGN HOOK 2 of 2.
  const savedOpen = () => page.evaluate(() => JSON.parse(localStorage.getItem("battuta.settings.v1") ?? "{}").plugins?.["battuta.onscreen-keyboard"]?.values?.open);
  check("the choice is persisted", (await savedOpen()) === true);

  // --- 2. a tapped action key is a real key press --------------------------
  await clickFirstNote(page, 0);
  check("a note is under the caret to work from", (await caretEvent())?.tag === "note");

  await tap('[data-vk-key="inputMode"]');
  await page.waitForFunction(() => document.querySelector("main").dataset.entry !== "", null, { timeout: 5000 });
  check(`tapping "input" turns entry mode on (data-entry=${await entryMode()})`, (await entryMode()) !== "");

  // the digit pad carries e.key AND the physical Digit code: duration 4 = ♪
  const before = await entryMode();
  await page.locator('[data-vk-key="digitPad"]').filter({ hasText: "4" }).first().click({ force: true });
  await page.waitForFunction((b) => document.querySelector("main").dataset.entry !== b, before, { timeout: 5000 });
  check(`the digit pad sets the duration (${before} → ${await entryMode()})`, (await entryMode()) === "8");

  // --- 3. a tapped piano key reaches the entry path ------------------------
  const depth0 = await undoDepth();
  const pitches0 = await layerPitches();
  // D4, not middle C: the fixture already opens on c4, so a c4 would be
  // indistinguishable from no entry at all.
  check("the pitch about to be tapped is not already there", !(pitches0 ?? []).some((p) => p.split("+").includes("d4")));
  await pianoTap(62);
  await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth > d, depth0, { timeout: 10000 });
  const pitches1 = await layerPitches();
  check(`a tapped piano key entered a note (${pitches0?.slice(0, 3).join(" ")} → ${pitches1?.slice(0, 3).join(" ")})`, (await undoDepth()) === depth0 + 1);
  check("the entered pitch is the key that was tapped (d4)", (pitches1 ?? []).some((p) => p.split("+").includes("d4")));

  // --- 4. multi-touch is a chord ------------------------------------------
  const depth1 = await undoDepth();
  await pianoTap(64, [67]); // E4 held with G4
  await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth > d, depth1, { timeout: 10000 });
  const chord = (await layerPitches())?.find((p) => p.includes("+"));
  check(`two held keys entered a chord (${chord ?? "none"})`, Boolean(chord) && chord.split("+").length >= 2);

  // --- 5. the panel projects the UNION keymap -----------------------------
  // The reflection cycle is contributed by @battuta/plugin-reflection and
  // is a shift LATCH on the rest key, with no button of its own.
  const restLabel = await page.evaluate(() => document.querySelector('[data-vk-key="rest"]')?.textContent);
  await tap('[data-vk-mod="shift"]');
  await page.waitForFunction(() => document.querySelector('[data-vk-key="rest"]')?.textContent === "reflect", null, { timeout: 5000 });
  check(`shift relabels the rest key to a PLUGIN's binding ("${restLabel}" → "reflect")`, true);
  await tap('[data-vk-mod="shift"]'); // un-latch
  await page.waitForFunction((l) => document.querySelector('[data-vk-key="rest"]')?.textContent === l, restLabel, { timeout: 5000 });
  check("un-latching restores the caption", true);

  // --- 6. latches are one-shot -------------------------------------------
  await tap('[data-vk-mod="shift"]');
  check("shift latch is on", await page.evaluate(() => document.querySelector('[data-vk-mod="shift"]').style.background.includes("74, 125, 189")));
  await tap('[data-vk-key="tie"]'); // shift+t = tuplet; consumes the latch
  await page.waitForFunction(() => !document.querySelector('[data-vk-mod="shift"]').style.background.includes("74, 125, 189"), null, { timeout: 5000 });
  check("a tapped key consumes the latch (one-shot)", true);

  // --- 6b. the panel re-renders in PLACE, never remounting ---------------
  // The piano brightens in input mode, so the panel must see editor state
  // change live. It holds real state of its own (the latches, the held
  // notes, the octave rail), so it must do that WITHOUT being remounted:
  // re-opening the panel to show new data would reset the user's octave
  // mid-phrase. Both halves are checked here.
  const pianoOpacity = () => page.evaluate(() => getComputedStyle(document.querySelector("[data-vk-piano]")).opacity);
  await tap("[data-vk-oct-up]");
  await page.waitForFunction(() => document.querySelector("[data-vk-oct]").textContent === "C4", null, { timeout: 5000 });
  const entryBefore = await entryMode();
  check("input mode is on from the taps above", entryBefore !== "");
  // Insert toggles input mode BOTH ways; plain "i" only ENTERS it (the
  // editor deliberately keeps "i" free inside the mode), so Insert is the
  // key to use here.
  await page.keyboard.press("Insert");
  await page.waitForFunction(() => document.querySelector("main").dataset.entry === "", null, { timeout: 5000 });
  const dimmed = await pianoOpacity();
  await page.keyboard.press("Insert");
  await page.waitForFunction((b) => document.querySelector("main").dataset.entry === b, entryBefore, { timeout: 5000 });
  check(`the piano dims outside input mode and brightens in it (${dimmed} → ${await pianoOpacity()})`, dimmed === "0.55" && (await pianoOpacity()) === "1");
  check("…and the octave rail kept its place across those re-renders (no remount)", (await page.evaluate(() => document.querySelector("[data-vk-oct]").textContent)) === "C4");
  await tap("[data-vk-oct-down]");
  await page.waitForFunction(() => document.querySelector("[data-vk-oct]").textContent === "C3", null, { timeout: 5000 });

  // --- 7. the octave rail -------------------------------------------------
  const oct0 = await page.evaluate(() => document.querySelector("[data-vk-oct]").textContent);
  await tap("[data-vk-oct-up]");
  await page.waitForFunction((o) => document.querySelector("[data-vk-oct]").textContent !== o, oct0, { timeout: 5000 });
  const oct1 = await page.evaluate(() => document.querySelector("[data-vk-oct]").textContent);
  check(`the octave rail moves the piano (${oct0} → ${oct1})`, oct0 === "C3" && oct1 === "C4");
  check("…and the keys moved with it", await page.evaluate(() => Boolean(document.querySelector('[data-vk-note="72"]'))));
  await tap("[data-vk-oct-down]");
  await page.waitForFunction(() => document.querySelector("[data-vk-oct]").textContent === "C3", null, { timeout: 5000 });

  // --- 8. undo through the panel's own ctrl chord, and close --------------
  const depthEnd = await undoDepth();
  for (let i = 0; i < depthEnd; i++) {
    await tap('[data-vk-key="system"]:has-text("undo")').catch(() => undefined);
  }
  const unwound = await page
    .waitForFunction(() => window.__SESSION__.stack.undoDepth === 0, null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check(`the panel's undo button unwinds every edit it made (${depthEnd} steps)`, unwound);

  await tap("[data-vk-close]");
  await page.waitForFunction(() => !document.querySelector("[data-vkeys]"), null, { timeout: 5000 });
  check("× closes the panel", !(await panelOpen()));
  check("the closed choice is persisted", (await savedOpen()) === false);
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
