/**
 * Spike B — slice vs full-document render timing (Node / WASM).
 *
 * Questions answered:
 *  1. What does a full-document load+layout cost on real files?
 *  2. What does a single-measure (and 4-measure window) slice cost?
 *  3. Is tiling worth it? (slice cost ≪ full cost, and slice cost fits the
 *     50 ms edit-latency budget)
 *
 * Method: one reused toolkit; loadData replaces the document (same as a tile
 * renderer would). Warmup runs excluded; p50/p95 over N iterations.
 * Writes spikes/out/spike-b-results.json for the benchmark report.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { performance } from "node:perf_hooks";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { parseMei, getMeasures, getScoreDef, synthesizeSlice, TILE_OPTIONS, PAGE_OPTIONS } from "./lib/slice.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = [
  "Bach-JS_Ein_feste_Burg.mei",
  "Beethoven_Hymn_to_joy.mei",
  "Bach-JS_BrandenburgConcert_No2_I_BWV1047.mei",
  "Beethoven_StringQuartet_Op18_No1.mei",
];
const N_FULL = 5;
const N_SLICE = 10;
const SLICE_SAMPLES = 8; // measures sampled evenly across the score
const WINDOW = 4; // multi-measure window size

const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor(q * s.length));
  return s[i];
};
const ms = (x) => Math.round(x * 100) / 100;

const VerovioModule = await createVerovioModule();
const toolkit = new VerovioToolkit(VerovioModule);
console.log(`verovio ${toolkit.getVersion()}\n`);

const results = { runner: "node-wasm", verovio: toolkit.getVersion(), node: process.version, fixtures: [] };

for (const name of FIXTURES) {
  const path = join(here, "../fixtures", name);
  const { xml, doc } = parseMei(path);
  const measures = getMeasures(doc);
  const scoreDef = getScoreDef(doc);
  console.log(`=== ${name} (${measures.length} measures, ${Math.round(xml.length / 1024)} KB)`);

  // --- Full document, paged layout ---
  toolkit.setOptions(PAGE_OPTIONS);
  const fullLoad = [], fullPage1 = [];
  let pageCount = 0;
  for (let i = 0; i < N_FULL + 1; i++) {
    let t0 = performance.now();
    toolkit.loadData(xml);
    const t1 = performance.now();
    const svg = toolkit.renderToSVG(1);
    const t2 = performance.now();
    if (i > 0) { fullLoad.push(t1 - t0); fullPage1.push(t2 - t1); }
    pageCount = toolkit.getPageCount();
  }
  console.log(`  full: load+layout p50 ${ms(quantile(fullLoad, 0.5))} ms  |  render page 1 p50 ${ms(quantile(fullPage1, 0.5))} ms  |  ${pageCount} pages`);

  // --- Slices ---
  toolkit.setOptions(TILE_OPTIONS);
  const step = Math.max(1, Math.floor(measures.length / SLICE_SAMPLES));
  const sampleIdx = Array.from({ length: Math.min(SLICE_SAMPLES, measures.length) }, (_, k) => k * step);

  for (const win of [1, WINDOW]) {
    const times = [];
    let svgBytes = 0;
    for (const idx of sampleIdx) {
      const slice = synthesizeSlice(scoreDef, measures.slice(idx, idx + win));
      // warmup once per slice content
      toolkit.loadData(slice); toolkit.renderToSVG(1);
      for (let i = 0; i < N_SLICE; i++) {
        const t0 = performance.now();
        toolkit.loadData(slice);
        const svg = toolkit.renderToSVG(1);
        const t1 = performance.now();
        times.push(t1 - t0);
        svgBytes = svg.length;
      }
    }
    console.log(`  slice[${win} measure${win > 1 ? "s" : ""}]: p50 ${ms(quantile(times, 0.5))} ms  p95 ${ms(quantile(times, 0.95))} ms  (svg ~${Math.round(svgBytes / 1024)} KB)`);
    results.fixtures.push({
      fixture: name, measures: measures.length, mode: `slice-${win}`,
      p50: ms(quantile(times, 0.5)), p95: ms(quantile(times, 0.95)), svgKB: Math.round(svgBytes / 1024),
    });
  }
  results.fixtures.push({
    fixture: name, measures: measures.length, mode: "full",
    loadP50: ms(quantile(fullLoad, 0.5)), page1P50: ms(quantile(fullPage1, 0.5)), pages: pageCount,
  });
  console.log();
}

mkdirSync(join(here, "out"), { recursive: true });
writeFileSync(join(here, "out", "spike-b-results.json"), JSON.stringify(results, null, 2));
console.log("wrote spikes/out/spike-b-results.json");
