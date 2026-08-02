/**
 * Spike C — persistent document + select() vs slice reload per render.
 *
 * Questions answered:
 *  1. Within the slice-reload path, does loadData dominate renderToSVG?
 *  2. Is (select + redoLayout + render) on a persistently loaded document
 *     cheaper per tile than (loadData(slice) + render)?
 *  3. How do both scale with tile width (1 / 4 / 8 measures)?
 *
 * Also reports the asymmetries that matter beyond per-tile speed:
 *  - persistent init = full loadData per worker (and again after every edit,
 *    since an edit invalidates the loaded document);
 *  - slice mode pays XML slice synthesis on the main/core side instead.
 *
 * Usage: node spikes/spike-c-persistent-select.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { parseMei, getMeasures, getScoreDef, synthesizeSlice, TILE_OPTIONS } from "./lib/slice.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = ["Beethoven_Hymn_to_joy.mei", "Beethoven_StringQuartet_Op18_No1.mei"];
const WINDOWS = [1, 4, 8];
const SAMPLES = 6;
const ITERS = 8;

const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const r2 = (x) => Math.round(x * 100) / 100;
const p = (xs) => `${r2(quantile(xs, 0.5))} / ${r2(quantile(xs, 0.95))}`;

const VerovioModule = await createVerovioModule();
const toolkit = new VerovioToolkit(VerovioModule);
console.log(`verovio ${toolkit.getVersion()}\n`);
const results = { runner: "node-wasm", spike: "c", groups: [] };

for (const name of FIXTURES) {
  const path = join(here, "../fixtures", name);
  const { xml, doc } = parseMei(path);
  const measures = getMeasures(doc);
  const scoreDef = getScoreDef(doc);
  const step = Math.max(1, Math.floor(measures.length / SAMPLES));
  const sampleIdx = Array.from({ length: SAMPLES }, (_, k) => k * step);
  console.log(`=== ${name} (${measures.length} measures)`);

  toolkit.setOptions(TILE_OPTIONS);

  // --- Persistent init: full parse + layout of an initial 1-measure selection.
  toolkit.select({ measureRange: "1" });
  let t0 = performance.now();
  toolkit.loadData(xml);
  const initMs = r2(performance.now() - t0);
  console.log(`  persistent init (loadData full, selection pending): ${initMs} ms`);

  for (const win of WINDOWS) {
    // --- Mode 1: slice reload (loadData split from render) ---
    const loadT = [], renderT = [];
    for (const idx of sampleIdx) {
      const slice = synthesizeSlice(scoreDef, measures.slice(idx, idx + win));
      toolkit.loadData(slice); toolkit.renderToSVG(1); // warmup
      for (let i = 0; i < ITERS; i++) {
        const a = performance.now();
        toolkit.loadData(slice);
        const b = performance.now();
        toolkit.renderToSVG(1);
        const c = performance.now();
        loadT.push(b - a); renderT.push(c - b);
      }
    }
    const sliceTotal = loadT.map((x, i) => x + renderT[i]);

    // --- Mode 2: persistent + select + redoLayout ---
    // Reload the full document (previous mode left slice data loaded).
    toolkit.select({ measureRange: "1" });
    toolkit.loadData(xml);
    const selT = [], selRenderT = [];
    let verified = true;
    for (const idx of sampleIdx) {
      const range = win === 1 ? String(idx + 1) : `${idx + 1}-${Math.min(idx + win, measures.length)}`;
      toolkit.select({ measureRange: range }); toolkit.redoLayout(); toolkit.renderToSVG(1); // warmup
      for (let i = 0; i < ITERS; i++) {
        const a = performance.now();
        toolkit.select({ measureRange: range });
        toolkit.redoLayout();
        const b = performance.now();
        const svg = toolkit.renderToSVG(1);
        const c = performance.now();
        selT.push(b - a); selRenderT.push(c - b);
        if (i === 0) {
          const id = measures[idx].getAttribute("xml:id");
          if (id && !svg.includes(`"${id}"`)) verified = false;
        }
      }
    }
    const selTotal = selT.map((x, i) => x + selRenderT[i]);

    console.log(`  [${win}m] slice-reload: total p50/p95 ${p(sliceTotal)}  (loadData ${p(loadT)} | render ${p(renderT)})`);
    console.log(`  [${win}m] persistent  : total p50/p95 ${p(selTotal)}  (select+redoLayout ${p(selT)} | render ${p(selRenderT)})${verified ? "" : "  !! WRONG CONTENT"}`);
    results.groups.push({
      fixture: name, window: win, initMs,
      slice: { total50: r2(quantile(sliceTotal, 0.5)), total95: r2(quantile(sliceTotal, 0.95)), load50: r2(quantile(loadT, 0.5)), render50: r2(quantile(renderT, 0.5)) },
      persistent: { total50: r2(quantile(selTotal, 0.5)), total95: r2(quantile(selTotal, 0.95)), select50: r2(quantile(selT, 0.5)), render50: r2(quantile(selRenderT, 0.5)), verified },
    });
  }
  console.log();
}

mkdirSync(join(here, "out"), { recursive: true });
writeFileSync(join(here, "out", "spike-c-results.json"), JSON.stringify(results, null, 2));
console.log("wrote spikes/out/spike-c-results.json");
