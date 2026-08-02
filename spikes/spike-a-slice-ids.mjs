/**
 * Spike A — slice rendering + xml:id preservation.
 *
 * Questions answered:
 *  1. Does a synthesized (scoreDef + one measure) slice render at all?
 *  2. Do the source xml:ids survive into the output SVG as element ids?
 *  3. Which element classes carry ids (hit-testing surface)?
 *
 * Usage: node spikes/spike-a-slice-ids.mjs [fixture.mei] [measureIndex]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { parseMei, getMeasures, getScoreDef, synthesizeSlice, collectIds, TILE_OPTIONS } from "./lib/slice.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = process.argv[2] ?? join(here, "../fixtures/Bach-JS_Ein_feste_Burg.mei");
const measureIndex = Number(process.argv[3] ?? 4);

const { doc } = parseMei(fixture);
const measures = getMeasures(doc);
const scoreDef = getScoreDef(doc);
const measure = measures[Math.min(measureIndex, measures.length - 1)];
console.log(`fixture: ${fixture}`);
console.log(`measures in score: ${measures.length}; slicing measure index ${measureIndex} (n=${measure.getAttribute("n")})`);

const sliceXml = synthesizeSlice(scoreDef, [measure]);
const sourceIds = collectIds(measure);
console.log(`source ids in measure: ${sourceIds.size}`);

const VerovioModule = await createVerovioModule();
const toolkit = new VerovioToolkit(VerovioModule);
toolkit.setOptions(TILE_OPTIONS);

const ok = toolkit.loadData(sliceXml);
if (!ok) {
  console.error("FAIL: Verovio refused the slice");
  process.exit(1);
}
console.log(`slice loaded; pages: ${toolkit.getPageCount()}`);
const svg = toolkit.renderToSVG(1);

// Check id preservation: Verovio emits <g id="..."> for scored elements.
const svgIds = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
let preserved = 0;
const missingByTag = new Map();
for (const [id, tag] of sourceIds) {
  if (svgIds.has(id)) preserved++;
  else missingByTag.set(tag, (missingByTag.get(tag) ?? 0) + 1);
}
console.log(`ids preserved in SVG: ${preserved}/${sourceIds.size}`);
if (missingByTag.size) {
  console.log("missing by tag (expected for non-graphical/container elements):");
  for (const [tag, n] of missingByTag) console.log(`  ${tag}: ${n}`);
}

// Breakdown of what carries ids, per tag — this is the hit-testing surface.
const byTag = new Map();
for (const [id, tag] of sourceIds) {
  if (svgIds.has(id)) byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
}
console.log("preserved by tag:");
for (const [tag, n] of byTag) console.log(`  ${tag}: ${n}`);

const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "spike-a-slice.svg"), svg);
writeFileSync(join(outDir, "spike-a-slice.mei"), sliceXml);
console.log(`wrote ${join(outDir, "spike-a-slice.svg")}`);

const verdict = preserved > 0 && preserved >= sourceIds.size * 0.5;
console.log(verdict ? "\nSPIKE A: PASS — ids survive slice rendering" : "\nSPIKE A: FAIL — id preservation insufficient");
process.exit(verdict ? 0 : 1);
