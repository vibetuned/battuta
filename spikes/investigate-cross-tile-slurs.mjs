/**
 * Establish the facts on control events at tile boundaries:
 *  1. Find a real slur/tie whose start and end are in DIFFERENT measures.
 *  2. Render the END measure's tile: is the curve drawn? what warnings?
 *  3. Test the candidate fix: tstamp-anchored slur (no startid) — does
 *     Verovio draw an incoming continuation curve?
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { fromDom, buildScore, resolveContexts, synthesizeTile, findAll } from "../packages/core/dist/index.js";
import { TILE_OPTIONS } from "./lib/slice.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const xml = readFileSync(join(here, "../fixtures/Beethoven_StringQuartet_Op18_No1.mei"), "utf8");
const score = buildScore(fromDom(new DOMParser().parseFromString(xml, "application/xml").documentElement));
const contexts = resolveContexts(score);

// Map xml:id -> measure index
const idToMeasure = new Map();
score.measures.forEach((m, i) => {
  for (const el of findAll(m, "note")) if (el.attrs["xml:id"]) idToMeasure.set(el.attrs["xml:id"], i);
});

// Find cross-measure slurs and ties
const crossers = [];
score.measures.forEach((m, i) => {
  for (const tag of ["slur", "tie"]) {
    for (const ev of findAll(m, tag)) {
      const start = ev.attrs["startid"]?.replace("#", "");
      const end = ev.attrs["endid"]?.replace("#", "");
      if (start && end && idToMeasure.has(start) && idToMeasure.has(end) && idToMeasure.get(start) !== idToMeasure.get(end)) {
        crossers.push({ tag, i, from: idToMeasure.get(start), to: idToMeasure.get(end), id: ev.attrs["xml:id"] });
      }
    }
  }
});
console.log(`cross-measure control events in movement 1: ${crossers.length}`);
console.log("first examples:", crossers.slice(0, 4));

const VerovioModule = await createVerovioModule();
const toolkit = new VerovioToolkit(VerovioModule);
toolkit.setOptions(TILE_OPTIONS);

const countCurves = (svg, cls) => (svg.match(new RegExp(`class="${cls}`, "g")) ?? []).length;

const ex = crossers.find((c) => c.tag === "slur");
console.log(`\nexample slur ${ex.id}: starts m${ex.from + 1}, ends m${ex.to + 1}`);
for (const idx of [ex.from, ex.to]) {
  const tile = synthesizeTile(score, contexts, idx);
  toolkit.loadData(tile.xml);
  const svg = toolkit.renderToSVG(1);
  const log = toolkit.getLog?.() ?? "";
  console.log(`tile m${idx + 1}: slur curves drawn = ${countCurves(svg, "slur")}; warnings about missing refs: ${(log.match(/Could not|not found|start or end/gi) ?? []).length}`);
}

// --- Candidate fix: tstamp-anchored slur, no startid ---
const fixTest = `<?xml version="1.0"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
  <music><body><mdiv><score>
    <scoreDef meter.count="4" meter.unit="4" keysig="0">
      <staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp>
    </scoreDef>
    <section>
      <measure n="5" xml:id="fm1">
        <staff n="1"><layer n="1">
          <note pname="e" oct="5" dur="2" xml:id="fn1"/>
          <note pname="d" oct="5" dur="2" xml:id="fn2"/>
        </layer></staff>
        <slur tstamp="0" endid="#fn2" staff="1" xml:id="fs1"/>
        <tie tstamp="0" endid="#fn1" staff="1" xml:id="ft1"/>
      </measure>
    </section>
  </score></mdiv></body></music></mei>`;
toolkit.loadData(fixTest);
const svgFix = toolkit.renderToSVG(1);
console.log(`\ntstamp-anchored continuation test: slur drawn = ${countCurves(svgFix, "slur")}, tie drawn = ${countCurves(svgFix, "tie")}`);
