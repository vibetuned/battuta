/**
 * Smoke test: render core-synthesized tiles through Verovio and verify
 * (a) every tile loads, (b) the effective context is visibly applied —
 * a tile after a key change must contain key-signature accidentals.
 * Run: node spikes/verify-core-tiles.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { fromDom, buildScore, resolveContexts, synthesizeTile, contextHash } from "../packages/core/dist/index.js";
import { TILE_OPTIONS } from "./lib/slice.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const VerovioModule = await createVerovioModule();
const toolkit = new VerovioToolkit(VerovioModule);
toolkit.setOptions(TILE_OPTIONS);

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

// --- Synthetic: key change + staff-local clef change ---
const synthetic = `<?xml version="1.0"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
  <music><body><mdiv><score>
    <scoreDef meter.count="4" meter.unit="4" keysig="0">
      <staffGrp symbol="brace"><label>Piano</label>
        <staffDef n="1" lines="5" clef.shape="G" clef.line="2"/>
        <staffDef n="2" lines="5" clef.shape="F" clef.line="4"/>
      </staffGrp>
    </scoreDef>
    <section>
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1"><note pname="c" oct="4" dur="1" xml:id="n1"/></layer></staff>
        <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1"/></layer></staff>
      </measure>
      <scoreDef keysig="4s"/>
      <measure n="2" xml:id="m2">
        <staff n="1"><layer n="1"><note pname="e" oct="4" dur="1" xml:id="n2"/></layer></staff>
        <staff n="2"><layer n="1"><note pname="e" oct="3" dur="1"/></layer></staff>
      </measure>
    </section>
  </score></mdiv></body></music></mei>`;

const score = buildScore(fromDom(new DOMParser().parseFromString(synthetic, "application/xml").documentElement));
const contexts = resolveContexts(score);
const t1 = synthesizeTile(score, contexts, 0);
const t2 = synthesizeTile(score, contexts, 1);

toolkit.loadData(t1.xml);
const svg1 = toolkit.renderToSVG(1);
toolkit.loadData(t2.xml);
const svg2 = toolkit.renderToSVG(1);
// keysig=0 yields an empty keySig group; count sharp glyphs (SMuFL E262).
const sharps = (svg) => (svg.match(/E262/g) ?? []).length;
check("tile m1 (C major) shows no sharps", sharps(svg1) === 0);
check("tile m2 (after keysig=4s scoreDef) shows sharps on both staves", sharps(svg2) >= 8);
check("tile m2 keeps source note id", svg2.includes(`"n2"`));
check("cache keys differ across the key change", t1.key.split("-")[0] !== t2.key.split("-")[0]);

const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "core-tile-m2.svg"), svg2);

// --- Cross-tile curve segmentation (synthetic fixture has m1->m2 slur+tie) ---
{
  const fx = readFileSync(join(here, "../fixtures/synthetic-context-changes.mei"), "utf8");
  const s = buildScore(fromDom(new DOMParser().parseFromString(fx, "application/xml").documentElement));
  const ctxs = resolveContexts(s);
  const curves = (svg, cls) => (svg.match(new RegExp(`class="${cls}`, "g")) ?? []).length;
  toolkit.loadData(synthesizeTile(s, ctxs, 0).xml);
  const svgA = toolkit.renderToSVG(1);
  toolkit.loadData(synthesizeTile(s, ctxs, 1).xml);
  const svgB = toolkit.renderToSVG(1);
  check("cross-tile slur: outgoing stub drawn in start tile", curves(svgA, "slur") >= 1);
  check("cross-tile tie: outgoing stub drawn in start tile", curves(svgA, "tie") >= 1);
  check("cross-tile slur: incoming stub drawn in end tile", curves(svgB, "slur") >= 1);
  check("cross-tile tie: incoming stub drawn in end tile", curves(svgB, "tie") >= 1);
  toolkit.loadData(synthesizeTile(s, ctxs, 0, 2).xml);
  const svgAB = toolkit.renderToSVG(1);
  check("window containing both anchors draws intact curves, no stubs", curves(svgAB, "slur") === 1 && curves(svgAB, "tie") === 1);
}

// --- Real corpus: every tile of every fixture loads and renders ---
for (const name of ["Bach-JS_Ein_feste_Burg.mei", "Beethoven_Hymn_to_joy.mei", "Bach-JS_BrandenburgConcert_No2_I_BWV1047.mei", "Beethoven_StringQuartet_Op18_No1.mei"]) {
  const xml = readFileSync(join(here, "../fixtures", name), "utf8");
  const s = buildScore(fromDom(new DOMParser().parseFromString(xml, "application/xml").documentElement));
  const ctxs = resolveContexts(s);
  let rendered = 0, failed = 0, contextChanges = 0;
  let prevHash = null;
  for (let i = 0; i < s.measures.length; i++) {
    const h = contextHash(ctxs[i]);
    if (prevHash !== null && h !== prevHash) contextChanges++;
    prevHash = h;
    const tile = synthesizeTile(s, ctxs, i);
    if (toolkit.loadData(tile.xml) && toolkit.renderToSVG(1).includes("<svg")) rendered++;
    else failed++;
  }
  check(`${name}: ${rendered}/${s.measures.length} tiles render (${contextChanges} context changes)`, failed === 0);
}

process.exit(failures ? 1 : 0);
