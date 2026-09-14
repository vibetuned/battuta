/**
 * Lyrics lane end-to-end check — the lane as the user types it.
 *
 * Written before slice 5a's extraction, against the in-App lane, so the
 * move of the lane MECHANISM into the host (5a) and of the lyrics BODY
 * into a plugin (5b) have something to be behaviour-neutral against
 * (PLANNING.md: "No committed e2e types lyrics today: the slice adds one
 * first"). Everything is driven by the physical keyboard, the way the
 * guide describes it (docs: guide/harmony, "Lyrics"):
 *
 *  1. `l` at a note opens the lane; its editor sits under the staff
 *  2. a syllable + `-` writes <syl wordpos="i" con="d"> and advances to
 *     the next NOTE — over a rest
 *  3. the next syllable + space closes the word (wordpos="t"), Enter after
 *     a whole word writes neither attribute
 *  4. Escape commits and leaves; the buffer reloads when the caret comes
 *     back to a note that has a syllable
 *  5. an empty commit on a rest is allowed (and moves on); on a note it
 *     clears the syllable
 *  6. the saved document re-parses with the syllables in it
 *  7. undo unwinds every step and the MEI is byte-identical
 *
 * Run: BATTUTA_ROOT=$PWD CHROME=bundled SCRATCH=/tmp/battuta-e2e node spikes/verify-lyrics.mjs
 */
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { fromDom, findAll } from "../packages/core/dist/index.js";
import { clickFirstNote, menuClick } from "./lib/e2e.mjs";

const ROOT = process.env.BATTUTA_ROOT ?? "/home/flux/projects/battuta";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const SCRATCH = process.env.SCRATCH ?? "/tmp/battuta-e2e";
mkdirSync(SCRATCH, { recursive: true });

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
const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(server.resolvedUrls.local[0] + "?pool=2");
try {
  await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 10, null, { timeout: 60000 });

  // --- helpers ---------------------------------------------------------------
  const undoDepth = () => page.evaluate(() => window.__SESSION__.stack.undoDepth);
  const entryMode = () => page.evaluate(() => document.querySelector("main").dataset.entry);
  const caretId = () => page.evaluate(() => document.querySelector("main").dataset.caret || null);
  // DESIGN HOOK 1 of 2: the lane's floating editor. Today `[data-harm-input]`
  // (the lanes share one box); 5a keeps the hook, a plugin lane may not.
  const laneText = () => page.evaluate(() => document.querySelector("[data-harm-input]")?.textContent ?? null);
  const laneOpen = () => page.evaluate(() => Boolean(document.querySelector("[data-harm-input]")));
  const waitLane = (open) => page.waitForFunction((o) => Boolean(document.querySelector("[data-harm-input]")) === o, open, { timeout: 5000 });
  const waitCaret = (id) => page.waitForFunction((x) => document.querySelector("main").dataset.caret === x, id, { timeout: 5000 });
  const waitLaneText = (s) => page.waitForFunction((x) => (document.querySelector("[data-harm-input]")?.textContent ?? "").includes(x), s, { timeout: 5000 });
  /** The caret's layer as [{ id, kind, pitches }] in order (kind = note | chord | rest | other). */
  const layerEvents = () =>
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
        const notes = [];
        const walk = (e) => {
          if (e.tag === "note") notes.push(`${e.attrs.pname}${e.attrs.oct}`);
          for (const c of e.children ?? []) if (typeof c !== "string") walk(c);
        };
        if (el) walk(el);
        const tag = el?.tag ?? "?";
        return { id: eid, kind: tag === "note" || tag === "chord" || tag === "rest" ? tag : "other", pitches: notes.join("+") };
      });
    });
  /** The verse-1 syllable of an event as { text, wordpos, con } or null — read off the model, like sylAt does. */
  const sylOf = (id) =>
    page.evaluate((x) => {
      const s = window.__SESSION__;
      const ref = s.index.byId.get(x);
      if (!ref) return null;
      let found = null;
      const walk = (el) => {
        if (found) return;
        if (el.attrs?.["xml:id"] === x) found = el;
        else for (const c of el.children ?? []) if (typeof c !== "string") walk(c);
      };
      walk(s.score.measures[ref.measureIndex]);
      if (!found) return null;
      const note = found.tag === "chord" ? found.children.find((c) => typeof c !== "string" && c.tag === "note") : found;
      const verse = note?.children.find((c) => typeof c !== "string" && c.tag === "verse");
      const syl = verse?.children.find((c) => typeof c !== "string" && c.tag === "syl");
      if (!syl) return null;
      return { text: syl.children.filter((c) => typeof c === "string").join(""), wordpos: syl.attrs.wordpos ?? null, con: syl.attrs.con ?? null };
    }, id);
  /** Click an event by id and wait for the caret to land — retrying, because rows reflow while renders settle. */
  const clickEvent = async (id) => {
    for (let i = 0; i < 6; i++) {
      await page.locator(`g[id="${id}"] use`).first().click({ force: true, timeout: 3000 }).catch(() => undefined);
      try {
        await waitCaret(id);
        return;
      } catch {
        /* reflowed mid-click: try again */
      }
    }
    throw new Error(`clickEvent(${id}) never landed`);
  };
  const mei0 = await page.evaluate(() => window.__SESSION__.saveDocument());
  const depth0 = await undoDepth();

  // --- 0. material: a note, a rest, a note -----------------------------------
  // The fixture opens on a quarter c4; entering an EIGHTH d4 over it splits
  // it into d4 + an eighth rest, followed by the e4 that was there — exactly
  // the note / rest / note the advance rule needs (the same move the
  // keyboard e2e makes).
  await clickFirstNote(page, 0);
  await page.keyboard.press("i");
  await page.waitForFunction(() => document.querySelector("main").dataset.entry !== "", null, { timeout: 5000 });
  await page.keyboard.press("4");
  await page.waitForFunction(() => document.querySelector("main").dataset.entry === "8", null, { timeout: 5000 });
  const dEntry = await undoDepth();
  await page.keyboard.press("d");
  await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth > d, dEntry, { timeout: 10000 });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector("main").dataset.entry === "", null, { timeout: 5000 });
  const layer = await layerEvents();
  const iD = layer.findIndex((e) => e.kind === "note" && e.pitches === "d4");
  const run = layer.slice(iD, iD + 3);
  check(`material in place: ${run.map((e) => e.pitches || e.kind).join(" ")} (note, rest, note)`, run.length === 3 && run[0].kind === "note" && run[1].kind === "rest" && (run[2].kind === "note" || run[2].kind === "chord"));
  const [first, rest, second] = run.map((e) => e.id);
  const tagOf = (id) => page.evaluate((x) => window.__SESSION__.index.byId.get(x)?.tag ?? null, id);

  // --- 1. `l` opens the lane at a note --------------------------------------
  await clickEvent(first);
  check("the lane is closed to begin with", !(await laneOpen()));
  await page.keyboard.press("l");
  await waitLane(true);
  check("`l` at a note opens the lyrics lane", await laneOpen());
  check("the lane editor shows the lyrics glyph and an empty buffer", (await laneText())?.includes("♪") && (await laneText())?.includes("…"));
  check("the editor sits BELOW the caret (lyrics go under the staff)", await page.evaluate(() => {
    const box = document.querySelector("[data-harm-input]").getBoundingClientRect();
    const caret = document.querySelector(".caret").getBoundingClientRect();
    return box.top > caret.top;
  }));
  check("a lyrics buffer is never marked invalid", await page.evaluate(() => document.querySelector("[data-harm-input]").dataset.valid === "1"));

  // --- 2. syllable + `-` : hyphen, and the advance skips the rest -----------
  const depthLyrics0 = await undoDepth();
  await page.keyboard.type("hel");
  await waitLaneText("hel");
  check("typed letters build the buffer", (await laneText())?.includes("hel"));
  await page.keyboard.press("-");
  await waitCaret(second);
  const s1 = await sylOf(first);
  check(`"hel" + "-" wrote wordpos="i" con="d" (${JSON.stringify(s1)})`, s1?.text === "hel" && s1.wordpos === "i" && s1.con === "d");
  check("…and advanced to the next NOTE, over the rest", (await caretId()) === second);
  check("…the rest carries no syllable", (await sylOf(rest)) === null);
  check("…as one undo step", (await undoDepth()) === depthLyrics0 + 1);
  check("the buffer is empty again at the next note", (await laneText())?.includes("…"));

  // --- 3. the word closes; then a whole word ---------------------------------
  await page.keyboard.type("lo");
  await waitLaneText("lo");
  await page.keyboard.press(" ");
  // the advance crosses into the next measure when the layer ends: wherever
  // the caret lands is the next NOTE, and that is the third target
  await page.waitForFunction((x) => document.querySelector("main").dataset.caret !== x, second, { timeout: 5000 });
  const third = await caretId();
  check(`space advanced to the next note, across the barline if need be (${await tagOf(third)})`, ["note", "chord"].includes(await tagOf(third)));
  const s2 = await sylOf(second);
  check(`"lo" + space after a hyphen wrote wordpos="t" and no con (${JSON.stringify(s2)})`, s2?.text === "lo" && s2.wordpos === "t" && s2.con === null);
  await page.keyboard.type("world");
  await waitLaneText("world");
  await page.keyboard.press("Enter");
  // the commit lands before the caret moves (or the "last note" notice shows): wait for the verse itself
  await page.waitForFunction((id) => {
    const s = window.__SESSION__;
    const ref = s.index.byId.get(id);
    let found = null;
    const walk = (el) => { if (found) return; if (el.attrs?.["xml:id"] === id) found = el; else for (const c of el.children ?? []) if (typeof c !== "string") walk(c); };
    walk(s.score.measures[ref.measureIndex]);
    const note = found.tag === "chord" ? found.children.find((c) => typeof c !== "string" && c.tag === "note") : found;
    return Boolean(note?.children.find((c) => typeof c !== "string" && c.tag === "verse"));
  }, third, { timeout: 5000 });
  const s3 = await sylOf(third);
  check(`a whole word + Enter wrote neither wordpos nor con (${JSON.stringify(s3)})`, s3?.text === "world" && s3.wordpos === null && s3.con === null);
  check("Enter moved on (or reported the last note)", (await caretId()) !== third || (await page.evaluate(() => document.querySelector("[data-notice]")?.textContent ?? "")).includes("last note"));

  // --- 4. Escape commits and leaves; the buffer reloads ---------------------
  await page.keyboard.press("Escape");
  await waitLane(false);
  check("Escape leaves the lane", !(await laneOpen()));
  const depthAfterWords = await undoDepth();
  await clickEvent(first);
  await page.keyboard.press("l");
  await waitLane(true);
  await waitLaneText("hel");
  check("re-opening at a note that has a syllable reloads it into the buffer", (await laneText())?.includes("hel"));
  await page.keyboard.press("Escape");
  await waitLane(false);
  check("Escape on an unchanged buffer adds no undo step", (await undoDepth()) === depthAfterWords);

  // --- 5. empty commits: allowed on a rest, a clear on a note ---------------
  await clickEvent(rest);
  await page.keyboard.press("l");
  await waitLane(true);
  check("the lane opens on a rest too (the caret may pass through one)", await laneOpen());
  await page.keyboard.press("Enter");
  await waitCaret(second);
  check("an empty commit on a rest is allowed and moves on to the next note", (await caretId()) === second && (await undoDepth()) === depthAfterWords);
  await waitLaneText("lo");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.waitForFunction(() => (document.querySelector("[data-harm-input]")?.textContent ?? "").includes("…"), null, { timeout: 5000 });
  await page.keyboard.press("Enter");
  await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth > d, depthAfterWords, { timeout: 5000 });
  check(`an empty commit on a note clears its syllable (${JSON.stringify(await sylOf(second))})`, (await sylOf(second)) === null);
  await page.keyboard.press("Escape");
  await waitLane(false);

  // --- 6. the saved document carries the syllables -------------------------
  const [download] = await Promise.all([page.waitForEvent("download"), menuClick(page, "save")]);
  const savedPath = `${SCRATCH}/lyrics-saved.mei`;
  await download.saveAs(savedPath);
  const root = fromDom(new DOMParser().parseFromString(readFileSync(savedPath, "utf8"), "application/xml").documentElement);
  const syls = findAll(root, "syl").map((s) => ({ text: s.children.filter((c) => typeof c === "string").join(""), wordpos: s.attrs.wordpos ?? null, con: s.attrs.con ?? null }));
  check(`the saved MEI re-parses with the syllables (${syls.map((s) => s.text).join(" ")})`, syls.some((s) => s.text === "hel" && s.wordpos === "i" && s.con === "d") && syls.some((s) => s.text === "world" && s.wordpos === null && s.con === null) && !syls.some((s) => s.text === "lo"));
  check("every <syl> sits inside a <verse> inside a <note>", findAll(root, "verse").every((v) => v.children.some((c) => typeof c !== "string" && c.tag === "syl")) && findAll(root, "note").some((n) => n.children.some((c) => typeof c !== "string" && c.tag === "verse")));

  // --- 7. undo unwinds everything, byte for byte ---------------------------
  const depthEnd = await undoDepth();
  for (let i = 0; i < depthEnd - depth0; i++) await page.keyboard.press("Control+z");
  await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth === d, depth0, { timeout: 15000 });
  const mei1 = await page.evaluate(() => window.__SESSION__.saveDocument());
  check(`undo unwinds the ${depthEnd - depth0} steps and the MEI is byte-identical`, mei1 === mei0);
} catch (e) {
  console.error("SCRIPT ERROR", e);
  failures++;
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
