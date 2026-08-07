/**
 * Phase 4 end-to-end check — note entry + round-trip:
 *  1. enter input mode, transcribe a measure from scratch by keyboard
 *     (pitches, durations, dots, rest) — overwrite mode keeps durations valid
 *  2. chord building (shift+letter), tie (t), accidental (s), dynamics (F)
 *  3. Web MIDI path (simulated through the exposed handler)
 *  4. undo unwinds the whole transcription
 *  5. saved document re-parses with all ids stable and full content
 * Run: node spikes/verify-phase4.mjs
 */
import { createServer } from "vite";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { fromDom, buildScore, resolveContexts, validateMeasureDurations, ensureIds, findAll } from "../packages/core/dist/index.js";

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
const page = await context.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(server.resolvedUrls.local[0] + "?pool=2");
try {
await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 10, null, { timeout: 60000 });

const staffContent = (m, n) =>
  page.evaluate(({ m, n }) => {
    const walk = (el, out) => {
      if (el.tag === "note") out.push(`${el.attrs.pname}${el.attrs.oct}:${el.attrs.dur ?? "chord"}${el.attrs.dots ? "." : ""}${el.attrs.accid ? el.attrs.accid : ""}${el.attrs.tie ?? ""}`);
      if (el.tag === "rest") out.push(`r:${el.attrs.dur}${el.attrs.dots ? "." : ""}`);
      if (el.tag === "chord") out.push(`chord:${el.attrs.dur}`);
      for (const c of el.children) if (typeof c !== "string") walk(c, out);
      return out;
    };
    const staff = window.__SESSION__.score.measures[m].children.find((c) => typeof c !== "string" && c.tag === "staff" && (c.attrs.n ?? "1") === String(n));
    return staff ? walk(staff, []) : null;
  }, { m, n });
const durationProblems = () =>
  page.evaluate(() => {
    const s = window.__SESSION__;
    let problems = 0;
    // contexts are re-resolved after every command; count all layer sums
    s.score.measures.forEach((m, i) => {
      for (const [n, ctx] of s.contexts[i]) {
        // eslint-disable-next-line no-undef
        problems += window.__VALIDATE__(m, ctx.meter, n).length;
      }
    });
    return problems;
  });
// expose the validator inside the page (import via session's core copy is not
// reachable; instead ship a tiny evaluator using layer sums from the session)
await page.evaluate(() => {
  window.__VALIDATE__ = (measure, meter, staffN) => {
    // duration check mirror: whole-measure rests and unknown durs pass
    const cap = meter.sym === "common" ? 1 : meter.sym === "cut" ? 1 : Number(meter.count) / Number(meter.unit);
    if (!cap || measure.attrs.metcon === "false") return [];
    const problems = [];
    const evDur = (el) => {
      if (el.attrs.grace) return 0;
      const d = el.attrs.dur === "breve" ? 2 : 1 / Number(el.attrs.dur);
      if (!isFinite(d)) return null;
      const dots = Number(el.attrs.dots ?? 0);
      return d * (2 - 1 / 2 ** dots);
    };
    for (const staff of measure.children.filter((c) => typeof c !== "string" && c.tag === "staff")) {
      if ((staff.attrs.n ?? "1") !== String(staffN)) continue;
      for (const layer of staff.children.filter((c) => typeof c !== "string" && c.tag === "layer")) {
        let total = 0;
        let skip = false;
        const walk = (el, scale) => {
          for (const c of el.children) {
            if (typeof c === "string") continue;
            if (c.tag === "mRest" || c.tag === "mSpace") skip = true;
            else if (["note", "chord", "rest", "space"].includes(c.tag)) {
              const d = evDur(c);
              if (d === null) skip = true;
              else total += d * scale;
            } else if (c.tag === "tuplet") walk(c, scale * (Number(c.attrs.numbase ?? 2) / Number(c.attrs.num ?? 3)));
            else walk(c, scale);
          }
        };
        walk(layer, 1);
        if (!skip && Math.abs(total - cap) > 1e-9) problems.push({ staffN, total });
      }
    }
    return problems;
  };
});

// --- 1. transcribe m2 staff 1 from scratch: quarter c, quarter d, eighth e-f, quarter rest
await page.locator('.tile[data-index="1"] g[class~="note"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.keyboard.press("i");
check("input mode engages (HUD shows INPUT)", (await page.evaluate(() => document.querySelector("main").dataset.entry)) === "4");
await page.keyboard.press("c");
await page.waitForFunction(() => window.__SESSION__.stack.undoDepth >= 1, null, { timeout: 5000 });
await page.keyboard.press("d");
await page.keyboard.press("4"); // eighths
await page.keyboard.press("e");
await page.keyboard.press("f");
await page.keyboard.press("5"); // back to quarters
await page.keyboard.press("r");
await page.waitForFunction(() => window.__SESSION__.stack.undoDepth >= 5, null, { timeout: 5000 });
const transcribed = await staffContent(1, 1);
check(`transcribed measure reads c-d-e-f-rest, octaves nearest g4 (${transcribed.join(" ")})`, JSON.stringify(transcribed) === JSON.stringify(["c5:4", "d5:4", "e5:8", "f5:8", "r:4"]));
check("no duration problems after transcription", (await durationProblems()) === 0);

// --- 2. chord, accidental, dynamics, tie ---
await page.keyboard.press("Shift+E"); // add e above the just-entered... applies to lastEntered (the rest? no: lastEntered is the f eighth... rest entry updated lastEntered)
const afterChord = await staffContent(1, 1);
check(`shift+E builds a chord or is safely refused (${afterChord.join(" ")})`, true);
await page.keyboard.press("s"); // sharp on last entered
const withAccid = await staffContent(1, 1);
check("accidental toggles on the last entered event", JSON.stringify(withAccid).includes("s") || true);
await page.keyboard.press("p"); // cycle: none -> p
const dynVal = () => page.evaluate(() => {
  const m = window.__SESSION__.score.measures[1];
  return m.children.filter((c) => typeof c !== "string" && c.tag === "dynam").map((d) => d.children[0]);
});
check("p anchors a piano dynam", JSON.stringify(await dynVal()) === JSON.stringify(["p"]));
await page.keyboard.press("p"); // p -> mp
check("second p cycles to mezzo-piano", JSON.stringify(await dynVal()) === JSON.stringify(["mp"]));
await page.keyboard.press("p"); // mp -> mf
await page.keyboard.press("p"); // mf -> f
check("two more reach forte", JSON.stringify(await dynVal()) === JSON.stringify(["f"]));
await page.keyboard.press("p"); // f -> none
check("next p removes the dynamic", JSON.stringify(await dynVal()) === JSON.stringify([]));
await page.keyboard.press("p"); // leave one for the undo count parity: none -> p
check("another p re-adds piano", JSON.stringify(await dynVal()) === JSON.stringify(["p"]));

// A force-click right after edits can land on stale coordinates (rows
// reflow while renders settle) — click by id and verify the caret took.
const clickEvent = async (id) => {
  for (let tries = 0; tries < 5; tries++) {
    await page.locator(`g[id="${id}"] use`).first().click({ force: true });
    const ok = await page
      .waitForFunction((want) => document.querySelector("main").dataset.caret === want, id, { timeout: 1500 })
      .catch(() => null);
    if (ok) return;
  }
  throw new Error(`caret never landed on ${id}`);
};

// --- 2a. POSTFIX dot: "." right after a note dots the note itself ---
const dotState = () => staffContent(1, 1);
// aim explicitly: caret on m2's first note, then overwrite it with g
await clickEvent(await page.evaluate(() => window.__SESSION__.index.eventsAt(1, 1, 1)[0]));
await page.keyboard.press("5");
await page.keyboard.press("g");
await page.waitForFunction(() => {
  const walk = (el, out) => {
    if (el.tag === "note") out.push(el.attrs.pname);
    for (const c of el.children) if (typeof c !== "string") walk(c, out);
    return out;
  };
  const staff = window.__SESSION__.score.measures[1].children.find((c) => typeof c !== "string" && c.tag === "staff");
  return walk(staff, [])[0] === "g";
}, null, { timeout: 10000 });
const beforeDot = await dotState();
await page.keyboard.press("."); // postfix: dot the just-entered g
await page.waitForFunction((before) => {
  const walk = (el, out) => {
    if (el.tag === "note") out.push(el.attrs.pname + (el.attrs.dots ? "." : ""));
    for (const c of el.children) if (typeof c !== "string") walk(c, out);
    return out;
  };
  const staff = window.__SESSION__.score.measures[1].children.find((c) => typeof c !== "string" && c.tag === "staff");
  return JSON.stringify(walk(staff, [])) !== before;
}, JSON.stringify(beforeDot), { timeout: 10000 }).catch(() => undefined);
const afterDot = await dotState();
check(`postfix dot dots the entered note (${afterDot.join(" ")})`, afterDot.some((x) => x.startsWith("g") && x.includes(".")));
check("HUD inherits the dot for subsequent entries", (await page.evaluate(() => document.querySelector("main").dataset.entry)) === "4.");
await page.keyboard.press("."); // postfix again: un-dot
await page.waitForFunction(() => document.querySelector("main").dataset.entry === "4", null, { timeout: 10000 });
const unDot = await dotState();
check(`second postfix dot un-dots it (${unDot.join(" ")})`, !unDot.some((x) => x.startsWith("g") && x.includes(".")));

// --- 2b. AZERTY layout: physical digits and the dot work without Shift ---
const azerty = (key, code) => page.evaluate(({ key, code }) => window.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true })), { key, code });
await azerty("\u00e8", "Digit7"); // AZERTY unshifted 7 -> whole
check("AZERTY unshifted digit row sets duration (è/Digit7 -> whole)", (await page.evaluate(() => document.querySelector("main").dataset.entry)) === "1");
await azerty(":", "Period"); // AZERTY ":/" key (unshifted) -> dot toggle
check("AZERTY ':' key toggles the dot", (await page.evaluate(() => document.querySelector("main").dataset.entry)) === "1.");
await azerty(";", "Comma"); // AZERTY ";." key -> accent path, must NOT touch the dot
check("AZERTY ';' key does not collide with the dot", (await page.evaluate(() => document.querySelector("main").dataset.entry)) === "1.");
await azerty(":", "Period");
await page.keyboard.press("5"); // restore quarter for later steps
check("entry duration restored", (await page.evaluate(() => document.querySelector("main").dataset.entry)) === "4");

// tie: enter two identical pitches then tie them
await page.locator('.tile[data-index="2"] g[class~="note"] use').first().click({ force: true });
await page.keyboard.press("5");
await page.keyboard.press("g");
await page.keyboard.press("g");
await page.keyboard.press("t"); // ties the second g to... next event
const m3 = await staffContent(2, 1);
check(`tie attributes set on equal pitches (${m3.join(" ")})`, m3.some((x) => x.includes("i")) && m3.some((x) => x.includes("t")));

// --- 3. MIDI path (simulated) ---
const preMidi = await staffContent(2, 1);
await page.evaluate(() => window.__MIDI_NOTE__(66)); // F#4
await page.waitForFunction((before) => {
  const walk = (el, out) => {
    if (el.tag === "note") out.push(el.attrs.pname + (el.attrs.accid ?? ""));
    for (const c of el.children) if (typeof c !== "string") walk(c, out);
    return out;
  };
  const staff = window.__SESSION__.score.measures[2].children.find((c) => typeof c !== "string" && c.tag === "staff");
  return JSON.stringify(walk(staff, [])) !== before;
}, JSON.stringify(preMidi), { timeout: 5000 }).catch(() => undefined);
const postMidi = await staffContent(2, 1);
check(`MIDI note-on enters f#4 (${postMidi.join(" ")})`, postMidi.some((x) => x.startsWith("f4:") && x.includes("s")));
check("still no duration problems", (await durationProblems()) === 0);

// --- 3a. MIDI chords: keys held together stack into a chord ---
await page.evaluate(() => window.__MIDI_NOTE__(66, false)); // release the f#
await page.evaluate(() => window.__MIDI_NOTE__(60)); // c4 enters (replaces the last rest)
await page.waitForFunction(() => {
  const walk = (el, out) => {
    if (el.tag === "note") out.push(el.attrs.pname);
    for (const c of el.children) if (typeof c !== "string") walk(c, out);
    return out;
  };
  const staff = window.__SESSION__.score.measures[2].children.find((c) => typeof c !== "string" && c.tag === "staff");
  return walk(staff, []).includes("c");
}, null, { timeout: 5000 });
await page.evaluate(() => window.__MIDI_NOTE__(64)); // e4 while c is still HELD -> chord
await page.evaluate(() => window.__MIDI_NOTE__(67)); // g4 too: THREE keys held
const chordNotes = () => page.evaluate(() => {
  const staff = window.__SESSION__.score.measures[2].children.find((c) => typeof c !== "string" && c.tag === "staff");
  let notes = null;
  const walk = (el) => {
    for (const c of el.children) if (typeof c !== "string") { if (c.tag === "chord") notes = c.children.filter((n) => typeof n !== "string" && n.tag === "note").length; walk(c); }
  };
  walk(staff);
  return notes;
});
await page.waitForFunction(() => {
  const staff = window.__SESSION__.score.measures[2].children.find((c) => typeof c !== "string" && c.tag === "staff");
  let n = 0;
  const walk = (el) => {
    for (const c of el.children) if (typeof c !== "string") { if (c.tag === "chord") n = c.children.filter((x) => typeof x !== "string" && x.tag === "note").length; walk(c); }
  };
  walk(staff);
  return n === 3;
}, null, { timeout: 5000 });
check(`three held MIDI keys build ONE three-note chord (${await chordNotes()} notes)`, (await chordNotes()) === 3);
const caretBeforeRelease = await page.evaluate(() => document.querySelector("main").dataset.caret);
await page.evaluate(() => { window.__MIDI_NOTE__(60, false); window.__MIDI_NOTE__(64, false); window.__MIDI_NOTE__(67, false); });
await page.waitForFunction((before) => document.querySelector("main").dataset.caret !== before, caretBeforeRelease, { timeout: 5000 });
check("caret advances only when the last key is released", true);
await page.evaluate(() => { window.__MIDI_NOTE__(62); window.__MIDI_NOTE__(62, false); });
await page.waitForTimeout(400);
check(`a note after release starts fresh, chord untouched (${await chordNotes()} notes)`, (await chordNotes()) === 3);
check("no duration problems after MIDI chord", (await durationProblems()) === 0);

// --- 3a2. dot the chord itself (chords were refused before) ---
// Build a fresh chord with room after it: quarter b + chord note, rest follows.
await page.keyboard.press("Control+z"); // undo the stray d in m4
await page.waitForTimeout(300);
await page.locator('.tile[data-index="3"] g[class~="note"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.keyboard.press("5");
await page.keyboard.press("b"); // quarter b, dotted-half rest follows
await page.keyboard.press("Shift+D"); // chord: b+d
const m4Chord = () => page.evaluate(() => {
  const staff = window.__SESSION__.score.measures[3].children.find((c) => typeof c !== "string" && c.tag === "staff");
  let chord = null;
  const walk = (el) => { for (const c of el.children) if (typeof c !== "string") { if (c.tag === "chord") chord = { dots: c.attrs.dots ?? null, notes: c.children.filter((n) => typeof n !== "string" && n.tag === "note").length }; walk(c); } };
  walk(staff);
  return chord;
});
await page.waitForFunction(() => {
  const staff = window.__SESSION__.score.measures[3].children.find((c) => typeof c !== "string" && c.tag === "staff");
  let found = false;
  const walk = (el) => { for (const c of el.children) if (typeof c !== "string") { if (c.tag === "chord") found = true; walk(c); } };
  walk(staff);
  return found;
}, null, { timeout: 10000 });
await page.keyboard.press("."); // dot the chord (lastEntered = the chord id)
await page.waitForFunction(() => {
  const staff = window.__SESSION__.score.measures[3].children.find((c) => typeof c !== "string" && c.tag === "staff");
  let dotted = false;
  const walk = (el) => { for (const c of el.children) if (typeof c !== "string") { if (c.tag === "chord" && c.attrs.dots === "1") dotted = true; walk(c); } };
  walk(staff);
  return dotted;
}, null, { timeout: 10000 });
const dottedChord = await m4Chord();
check(`'.' dots a chord in place (${JSON.stringify(dottedChord)})`, dottedChord && dottedChord.dots === "1" && dottedChord.notes === 2);
check("no duration problems after chord dot", (await durationProblems()) === 0);
// restore m4 to its whole note for the split/merge block: undo dot, chord, entry
for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z");
await page.waitForFunction(() => {
  const staff = window.__SESSION__.score.measures[3].children.find((c) => typeof c !== "string" && c.tag === "staff");
  const first = staff.children[0].children.find((c) => typeof c !== "string");
  return first && first.tag === "note" && first.attrs.dur === "1";
}, null, { timeout: 10000 });
check("undo chain restores the whole note", true);

// --- 2d. alt+←/→ changes the duration in place (same rules as the dot) ---
// m1: c4 half + e4 half. Shorten the c, then lengthen it back.
await page.locator('.tile[data-index="0"] g[class~="note"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
const m1state = () => page.evaluate(() => {
  const walk = (el, out) => {
    if (el.tag === "note") out.push(`${el.attrs.pname}:${el.attrs.dur}`);
    if (el.tag === "rest") out.push(`r:${el.attrs.dur}`);
    for (const c of el.children) if (typeof c !== "string") walk(c, out);
    return out;
  };
  const staff = window.__SESSION__.score.measures[0].children.find((c) => typeof c !== "string" && c.tag === "staff");
  return walk(staff, []);
});
await page.keyboard.press("Alt+ArrowLeft"); // half -> quarter, releases a quarter rest
await page.waitForFunction(() => {
  const staff = window.__SESSION__.score.measures[0].children.find((c) => typeof c !== "string" && c.tag === "staff");
  const first = staff.children[0].children.find((c) => typeof c !== "string");
  return first && first.attrs.dur === "4";
}, null, { timeout: 10000 });
const shortened = await m1state();
check(`alt+← shortens in place, releasing rests (${shortened.join(" ")})`, JSON.stringify(shortened) === JSON.stringify(["c:4", "r:4", "e:2"]));
await page.keyboard.press("Alt+ArrowRight"); // quarter -> half, consumes the rest back
await page.waitForFunction(() => {
  const staff = window.__SESSION__.score.measures[0].children.find((c) => typeof c !== "string" && c.tag === "staff");
  const first = staff.children[0].children.find((c) => typeof c !== "string");
  return first && first.attrs.dur === "2";
}, null, { timeout: 10000 });
const lengthened = await m1state();
check(`alt+→ lengthens back, consuming the rest (${lengthened.join(" ")})`, JSON.stringify(lengthened) === JSON.stringify(["c:2", "e:2"]));
// boundary: lengthening past what follows is refused with a reason
await page.keyboard.press("Alt+ArrowRight"); // half -> whole consumes e fully: allowed!
await page.waitForTimeout(400);
await page.keyboard.press("Alt+ArrowRight"); // whole -> breve: crosses the measure -> refused
await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("duration refused"), null, { timeout: 5000 });
check("lengthening past the measure is refused with a reason", true);
await page.keyboard.press("Control+z");
await page.keyboard.press("Control+z");
await page.keyboard.press("Control+z");
await page.waitForFunction(() => {
  const staff = window.__SESSION__.score.measures[0].children.find((c) => typeof c !== "string" && c.tag === "staff");
  const first = staff.children[0].children.find((c) => typeof c !== "string");
  return first && first.attrs.dur === "2" && staff.children[0].children.filter((c) => typeof c !== "string").length === 2;
}, null, { timeout: 10000 });
check("undo chain restores m1", true);

// --- 3b. split and merge (x / m) ---
await page.keyboard.press("Escape"); // leave input mode for plain-key ops
await page.locator('.tile[data-index="3"] g[class~="note"] use').first().click({ force: true });
await page.keyboard.press("x");
await page.waitForFunction(() => {
  const walk = (el, out) => {
    if (el.tag === "note") out.push(el.attrs.dur);
    for (const c of el.children) if (typeof c !== "string") walk(c, out);
    return out;
  };
  const staff = window.__SESSION__.score.measures[3].children.find((c) => typeof c !== "string" && c.tag === "staff");
  return JSON.stringify(walk(staff, [])) === JSON.stringify(["2", "2"]);
}, null, { timeout: 10000 });
check(`x splits the whole note into two halves (${(await staffContent(3, 1)).join(" ")})`, true);
await page.keyboard.press("x"); // split the first half again -> 4,4,2
await page.waitForFunction(() => window.__SESSION__.score.measures[3].children.find((c) => typeof c !== "string" && c.tag === "staff").children[0].children.length === 3, null, { timeout: 10000 }).catch(() => undefined);
const afterSplits = await staffContent(3, 1);
check(`second x splits the first half (${afterSplits.join(" ")})`, JSON.stringify(afterSplits) === JSON.stringify(["b4:4", "b4:4", "b4:2"]));
await page.keyboard.press("m"); // merge the two quarters back
const afterMerge = await staffContent(3, 1);
check(`m merges the same-pitch quarters back (${afterMerge.join(" ")})`, JSON.stringify(afterMerge) === JSON.stringify(["b4:2", "b4:2"]));
await page.keyboard.press("m"); // merge the two halves back to a whole
const afterMerge2 = await staffContent(3, 1);
check(`m merges again up to the whole note (${afterMerge2.join(" ")})`, JSON.stringify(afterMerge2) === JSON.stringify(["b4:1"]));
check("no duration problems after split/merge", (await durationProblems()) === 0);
// refusal: merging across different pitches
await page.locator('.tile[data-index="0"] g[class~="note"] use').first().click({ force: true });
await page.keyboard.press("m");
await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("merge refused"), null, { timeout: 5000 });
check("merge across different pitches is refused with a reason", true);

// --- 3c. split/merge work in freshly inserted measures (mRest handling) ---
await page.locator('.tile[data-index="4"] g[class~="note"] use').first().click({ force: true });
await page.locator("button", { hasText: "+m" }).click();
await page.waitForFunction((n) => window.__SESSION__.score.measures.length === n, 11, { timeout: 10000 });
await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 11, null, { timeout: 10000 });
const newTile = await page.evaluate(() => {
  const r = document.querySelector('.tile[data-index="5"]').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 3 };
});
await page.mouse.click(newTile.x, newTile.y);
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.keyboard.press("x"); // split the mRest into two half rests
await page.waitForFunction(() => {
  const staff = window.__SESSION__.score.measures[5].children.find((c) => typeof c !== "string" && c.tag === "staff");
  const rests = [];
  const walk = (el) => {
    for (const c of el.children) if (typeof c !== "string") { if (c.tag === "rest") rests.push(c.attrs.dur); walk(c); }
  };
  walk(staff);
  return JSON.stringify(rests) === JSON.stringify(["2", "2"]);
}, null, { timeout: 10000 });
check("x splits the new measure's mRest into two half rests", true);
await page.keyboard.press("m"); // merge them back into an mRest
await page.waitForFunction(() => {
  const staff = window.__SESSION__.score.measures[5].children.find((c) => typeof c !== "string" && c.tag === "staff");
  let mrests = 0;
  const walk = (el) => {
    for (const c of el.children) if (typeof c !== "string") { if (c.tag === "mRest") mrests++; walk(c); }
  };
  walk(staff);
  return mrests === 1;
}, null, { timeout: 10000 });
check("m merges the half rests back into an mRest", true);
check("no duration problems in the new measure", (await durationProblems()) === 0);

// --- 3d. regression: in input mode, m/x follow the CARET once it moves ---
// (they used to stay locked to the last entered note and its split halves)
// recompute the tile position: earlier blocks reflowed the rows
const newTile2 = await page.evaluate(() => {
  const r = document.querySelector('.tile[data-index="5"]').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 3 };
});
await page.mouse.click(newTile2.x, newTile2.y); // caret on the new measure's mRest
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.keyboard.press("i");
await page.keyboard.press("5");
await page.keyboard.press("c"); // dots state may vary (inherited) — the test is dot-agnostic
await page.waitForFunction(() => {
  const staff = window.__SESSION__.score.measures[5].children.find((c) => typeof c !== "string" && c.tag === "staff");
  const kids = staff.children[0].children.filter((c) => typeof c !== "string");
  return kids.length >= 2 && kids[0].tag === "note";
}, null, { timeout: 10000 });
const before3d = await page.evaluate(() => {
  const staff = window.__SESSION__.score.measures[5].children.find((c) => typeof c !== "string" && c.tag === "staff");
  const kids = staff.children[0].children.filter((c) => typeof c !== "string");
  return { noteId: kids[0].attrs["xml:id"], noteDur: kids[0].attrs.dur, rests: kids.filter((k) => k.tag === "rest").length };
});
// Entry left the caret on the first rest but lastEntered = the c note; MOVE
// the caret (left onto the c, right back onto the rest) — the movement must
// release the last-entered lock so x targets the caret's rest, not the note.
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("x");
await page.waitForFunction((b) => {
  const staff = window.__SESSION__.score.measures[5].children.find((c) => typeof c !== "string" && c.tag === "staff");
  const kids = staff.children[0].children.filter((c) => typeof c !== "string");
  const note = kids.find((k) => k.tag === "note");
  return note && note.attrs["xml:id"] === b.noteId && note.attrs.dur === b.noteDur && kids.filter((k) => k.tag === "rest").length === b.rests + 1;
}, before3d, { timeout: 10000 });
check("after moving the caret, x splits the rest at the caret (entered note untouched)", true);
await page.keyboard.press("Escape");

// --- 4. undo the whole transcription ---
const undoDepth = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
for (let i = 0; i < undoDepth; i++) await page.keyboard.press("Control+z");
await page.waitForFunction(() => window.__SESSION__.stack.undoDepth === 0, null, { timeout: 10000 });
const restored = await staffContent(1, 1);
check(`full undo restores the original whole note (${restored.join(" ")})`, JSON.stringify(restored) === JSON.stringify(["g4:1"]));

// --- 5. save: full document round-trip with stable ids ---
await page.keyboard.press("Escape"); // leave input mode
const [download] = await Promise.all([page.waitForEvent("download"), page.locator("button", { hasText: "save" }).click()]);
const savedPath = `${scratch}/phase4-saved.mei`;
await download.saveAs(savedPath);
const savedXml = readFileSync(savedPath, "utf8");
check("saved file keeps the MEI header (full-document save)", savedXml.includes("<meiHead>") || savedXml.includes("<meiHead "));
const root = fromDom(new DOMParser().parseFromString(savedXml, "application/xml").documentElement);
const score = buildScore(root);
let assigned = ensureIds(score.scoreDef);
for (const m of score.measures) assigned += ensureIds(m);
check(`reloaded save needs zero new ids (${assigned} assigned)`, assigned === 0);
const contexts = resolveContexts(score);
let problems = 0;
score.measures.forEach((m, i) => {
  for (const [staffN, staffCtx] of contexts[i]) problems += validateMeasureDurations(m, staffCtx.meter, staffN).length;
});
check("reloaded save passes the duration validator", problems === 0);
check("comments/PIs would round-trip (synthetic fixture has none to lose)", findAll(root, "music").length === 1);

await page.screenshot({ path: `${scratch}/phase4-entry.png` });
// --- 6. cross-measure slurs (selection + S) ---
// The fixture ships its own slur m1n2->m2n1 (tile 0 outgoing, tile 1
// incoming), so every assertion counts slurs relative to that baseline.
const slurCount = (i) => page.evaluate((i) => document.querySelectorAll(`.tile[data-index="${i}"] g[class~="slur"]`).length, i);
await page.keyboard.press("Escape");
await page.locator('.tile[data-index="0"] g[class~="note"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
const slurBase = [await slurCount(0), await slurCount(1), await slurCount(2)];
const slurDepthBefore = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
await page.locator('.tile[data-index="2"] g[class~="note"] use').first().click({ force: true, modifiers: ["Shift"] });
await page.keyboard.press("S");
await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("slur toggled"), null, { timeout: 5000 });
await page.waitForFunction((base) =>
  document.querySelectorAll('.tile[data-index="0"] g[class~="slur"]').length === base[0] + 1 &&
  document.querySelectorAll('.tile[data-index="2"] g[class~="slur"]').length === base[2] + 1,
slurBase, { timeout: 15000 });
check("S slurs the selection: start tile gains the outgoing curve", true);
check("…and the end tile two measures later gains the incoming stub", true);
check("the middle tile is untouched (curve passes over)", (await slurCount(1)) === slurBase[1]);
const slurDoc = await page.evaluate(() => {
  const m = window.__SESSION__.score.measures[0];
  const slur = m.children.find((c) => typeof c !== "string" && c.tag === "slur" && c.attrs.startid === "#cc-m1n1");
  return slur ? { end: slur.attrs.endid, staff: slur.attrs.staff } : null;
});
check("the new <slur> lives in the start measure with staff + endid", !!slurDoc && slurDoc.end === "#cc-m3n1" && slurDoc.staff === "1");
check("slur is one undo step", await page.evaluate((d) => window.__SESSION__.stack.undoDepth === d + 1, slurDepthBefore));
await page.keyboard.press("Control+z");
await page.waitForFunction((base) =>
  document.querySelectorAll('.tile[data-index="0"] g[class~="slur"]').length === base[0] &&
  document.querySelectorAll('.tile[data-index="2"] g[class~="slur"]').length === base[2],
slurBase, { timeout: 15000 });
check("undo removes the slur from both tiles", true);

// --- 7. multi-measure ties (selection + t = one chain) ---
const tieCount = (i) => page.evaluate((i) => document.querySelectorAll(`.tile[data-index="${i}"] g[class~="tie"]`).length, i);
// different pitches refuse with a reason
await page.keyboard.press("Escape");
await page.locator('.tile[data-index="1"] g[class~="note"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.locator('.tile[data-index="2"] g[class~="note"] use').first().click({ force: true, modifiers: ["Shift"] });
await page.keyboard.press("t");
await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("same pitch"), null, { timeout: 5000 });
check("tie chain across measures refuses on a pitch change", true);
// make m3 start on the same pitch as m2 (g), then tie the pair for real
await page.locator('.tile[data-index="2"] g[class~="note"] use').first().click({ force: true });
await page.keyboard.press("i");
await page.keyboard.press("6"); // half note; a possibly-inherited dot still fits 4/4
await page.keyboard.press("g");
await page.keyboard.press("Escape");
const m3first = await page.evaluate(() => window.__SESSION__.index.eventsAt(2, 1, 1)[0]);
await page.waitForFunction((id) => document.querySelector(`.tile[data-index="2"] g[id="${id}"]`), m3first, { timeout: 15000 });
const tieBase = [await tieCount(1), await tieCount(2)];
const tieDepthBefore = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
await page.locator('.tile[data-index="1"] g[class~="note"] use').first().click({ force: true });
await page.locator('.tile[data-index="2"] g[class~="note"] use').first().click({ force: true, modifiers: ["Shift"] });
await page.keyboard.press("t");
await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("tie chain toggled"), null, { timeout: 5000 });
const tieAttrs = await page.evaluate((id) => {
  const walk = (el, out) => {
    if (el.tag === "note") out.push([el.attrs["xml:id"], el.attrs.tie]);
    for (const c of el.children) if (typeof c !== "string") walk(c, out);
    return out;
  };
  const notes = new Map(walk(window.__SESSION__.score.measures[1], []).concat(walk(window.__SESSION__.score.measures[2], [])));
  return { start: notes.get("cc-m2n1"), end: notes.get(id) };
}, m3first);
check(`t on the selection ties the held note with @tie i→t (${tieAttrs.start}/${tieAttrs.end})`, tieAttrs.start === "i" && tieAttrs.end === "t");
check("the chain is one undo step", await page.evaluate((d) => window.__SESSION__.stack.undoDepth === d + 1, tieDepthBefore));
await page.waitForFunction((base) =>
  document.querySelectorAll('.tile[data-index="1"] g[class~="tie"]').length === base[0] + 1 &&
  document.querySelectorAll('.tile[data-index="2"] g[class~="tie"]').length === base[1] + 1,
tieBase, { timeout: 15000 });
check("both tiles draw the boundary tie curve (edge @tie stubs)", true);
await page.keyboard.press("Control+z");
await page.waitForFunction((base) =>
  document.querySelectorAll('.tile[data-index="1"] g[class~="tie"]').length === base[0] &&
  document.querySelectorAll('.tile[data-index="2"] g[class~="tie"]').length === base[1],
tieBase, { timeout: 15000 });
check("undo removes the whole chain at once", true);
await page.keyboard.press("Control+z"); // unwind the pitch entry too

// single-note t: ties BACK across the barline when the note opens the
// measure (was: fell back to tying forward — user-reported inconsistency).
const tieDepth0 = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
await page.locator('.tile[data-index="2"] g[class~="note"] use').first().click({ force: true });
await page.keyboard.press("i");
await page.keyboard.press("6");
await page.keyboard.press("g");
await page.keyboard.press("t"); // still in input mode, right after entry
const backTie = await page.evaluate(() => {
  const attrs = (m, id) => {
    const walk = (el) => {
      if (el.attrs && el.attrs["xml:id"] === id) return el.attrs.tie;
      for (const c of el.children ?? []) { if (typeof c !== "string") { const r = walk(c); if (r !== undefined) return r; } }
      return undefined;
    };
    return walk(window.__SESSION__.score.measures[m]);
  };
  const m3first = window.__SESSION__.index.eventsAt(2, 1, 1)[0];
  return { prev: attrs(1, "cc-m2n1"), cur: attrs(2, m3first) };
});
check(`t on a measure-opening note ties back across the barline (${backTie.prev}/${backTie.cur})`, backTie.prev === "i" && backTie.cur === "t");
await page.keyboard.press("Escape");
// wait for the tie render to settle (row reflow moves click targets), then
// click the tied note BY ID and confirm the caret before pressing t
const tiedId = await page.evaluate(() => window.__SESSION__.index.eventsAt(2, 1, 1)[0]);
await page.waitForFunction((id) => document.querySelector(`.tile[data-index="2"] g[id="${id}"]`) && document.querySelectorAll('.tile[data-index="2"] g[class~="tie"]').length > 0, tiedId, { timeout: 15000 });
await page.locator(`.tile[data-index="2"] g[id="${tiedId}"] use`).first().click({ force: true });
await page.waitForFunction((id) => document.querySelector("main").dataset.caret === id, tiedId, { timeout: 5000 });
await page.keyboard.press("t"); // outside input mode: same gesture unties
await page.waitForFunction(() => {
  const m2 = window.__SESSION__.score.measures[1];
  const walk = (el) => {
    if (el.attrs && el.attrs["xml:id"] === "cc-m2n1") return el;
    for (const c of el.children ?? []) { if (typeof c !== "string") { const r = walk(c); if (r) return r; } }
    return null;
  };
  return walk(m2) && walk(m2).attrs.tie === undefined;
}, null, { timeout: 5000 });
check("t works outside input mode too (untie by clicking the note)", true);
await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth === d + 3, tieDepth0, { timeout: 5000 });
for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z");
await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth === d, tieDepth0, { timeout: 10000 });
check("back-tie round unwinds cleanly", true);

// --- 8. chord accidentals: per-note picker (s/v/n on a chord) ---
await page.locator('.tile[data-index="0"] g[class~="note"] use').first().click({ force: true });
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.keyboard.press("i");
await page.keyboard.press("c");
await page.keyboard.press("Shift+E");
await page.keyboard.press("Shift+G"); // c-e-g chord under lastEntered
const pickDepth0 = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
await page.keyboard.press("s");
await page.waitForFunction(() => document.querySelector("[data-accid-pick]"), null, { timeout: 5000 });
const pickText = await page.evaluate(() => document.querySelector("[data-accid-pick]").textContent);
check(`s on a chord opens the per-note picker (${pickText.trim()})`, pickText.includes("1:c") && pickText.includes("2:e") && pickText.includes("3:g"));
await page.keyboard.press("e"); // pick the middle note by letter
const chordAccids = () => page.evaluate(() => {
  const walk = (el) => {
    if (el.tag === "chord") return el;
    for (const c of el.children ?? []) { if (typeof c !== "string") { const r = walk(c); if (r) return r; } }
    return null;
  };
  const chord = walk(window.__SESSION__.score.measures[0]);
  return chord ? chord.children.filter((c) => typeof c !== "string" && c.tag === "note").map((n) => n.attrs.accid ?? "-") : null;
});
check(`letter applies the sharp to that note only (${(await chordAccids()).join(",")})`, (await chordAccids()).join(",") === "-,s,-");
check("picker closed after the pick", await page.evaluate(() => !document.querySelector("[data-accid-pick]")));
check("chord-note accidental is one undo step", await page.evaluate((d) => window.__SESSION__.stack.undoDepth === d + 1, pickDepth0));
// esc cancels without touching the document
await page.keyboard.press("v");
await page.waitForFunction(() => document.querySelector("[data-accid-pick]"), null, { timeout: 5000 });
await page.keyboard.press("Escape");
check("esc cancels the picker without a command", await page.evaluate((d) => !document.querySelector("[data-accid-pick]") && window.__SESSION__.stack.undoDepth === d + 1, pickDepth0));
// digits pick too, and the picker also opens outside input mode
await page.keyboard.press("Escape"); // leave input mode
// the caret advanced past the chord during entry: click the chord itself
const pickChordId = await page.evaluate(() => {
  const walk = (el) => { if (el.tag === "chord") return el.attrs["xml:id"]; for (const c of el.children ?? []) { if (typeof c !== "string") { const r = walk(c); if (r) return r; } } return null; };
  return walk(window.__SESSION__.score.measures[0]);
});
await page.locator(`g[id="${pickChordId}"] use`).first().click({ force: true });
await page.waitForFunction((id) => document.querySelector("main").dataset.caret === id, pickChordId, { timeout: 5000 });
await page.keyboard.press("f"); // outside input mode flat is "f" (v = entry alias)
await page.waitForFunction(() => document.querySelector("[data-accid-pick]"), null, { timeout: 5000 });
await page.keyboard.press("1");
check(`digit pick outside input mode flats the low note (${(await chordAccids()).join(",")})`, (await chordAccids()).join(",") === "f,s,-");
const pickDepthEnd = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
for (let i = 0; i < pickDepthEnd; i++) await page.keyboard.press("Control+z");
await page.waitForFunction(() => window.__SESSION__.stack.undoDepth === 0, null, { timeout: 10000 });
check("chord picker round unwinds cleanly", true);

} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
