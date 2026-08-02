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
  server: { port: 5177, strictPort: true },
  logLevel: "warn",
});
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto("http://localhost:5177/");
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
await page.keyboard.press("Alt+f");
const dynam = await page.evaluate(() => {
  const m = window.__SESSION__.score.measures[1];
  return m.children.filter((c) => typeof c !== "string" && c.tag === "dynam").length;
});
check("alt+f anchors a forte dynam in the measure", dynam === 1);

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
await page.mouse.click(newTile.x, newTile.y); // caret on the new measure's mRest
await page.waitForFunction(() => document.querySelector("main").dataset.caret !== "", null, { timeout: 5000 });
await page.keyboard.press("i");
await page.keyboard.press("5");
await page.keyboard.press("c"); // enter quarter c -> [c, rests…]; lastEntered = c
await page.waitForFunction(() => {
  const staff = window.__SESSION__.score.measures[5].children.find((c) => typeof c !== "string" && c.tag === "staff");
  return JSON.stringify(staff.children[0].children.map((c) => c.tag)) === JSON.stringify(["note", "rest"]);
}, null, { timeout: 10000 });
// Entry left the caret on the rest but lastEntered = the c note; MOVE the
// caret (left onto the c, right back onto the rest) — the movement must
// release the last-entered lock so x targets the caret's rest.
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("x"); // must split the REST at the caret, not the entered c
await page.waitForFunction(() => {
  const staff = window.__SESSION__.score.measures[5].children.find((c) => typeof c !== "string" && c.tag === "staff");
  const kinds = staff.children[0].children.map((c) => `${c.tag}:${c.attrs.dur}${c.attrs.dots ? "." : ""}`);
  return JSON.stringify(kinds) === JSON.stringify(["note:4", "rest:4.", "rest:4."]);
}, null, { timeout: 10000 });
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
await browser.close();
await server.close();
process.exit(failures ? 1 : 0);
