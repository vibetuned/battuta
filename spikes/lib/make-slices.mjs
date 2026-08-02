/**
 * Pre-synthesize slice files shared by all runner benchmarks, so browser,
 * worker, and native runners time the exact same inputs.
 * Writes spikes/out/slices/<stem>/slice-<win>_<idx>.mei + manifest.json.
 */
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { parseMei, getMeasures, getScoreDef, synthesizeSlice } from "./slice.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = [
  "Beethoven_Hymn_to_joy.mei", // heavy: orchestral, many staves
  "Beethoven_StringQuartet_Op18_No1.mei", // typical: 4 staves, long
];
const SLICE_SAMPLES = 6;
const WINDOWS = [1, 4];

export function makeSlices() {
  const outRoot = join(here, "../out/slices");
  const manifest = { fixtures: [] };
  for (const name of FIXTURES) {
    const stem = basename(name, ".mei");
    const dir = join(outRoot, stem);
    mkdirSync(dir, { recursive: true });
    const path = join(here, "../../fixtures", name);
    const { doc } = parseMei(path);
    const measures = getMeasures(doc);
    const scoreDef = getScoreDef(doc);
    copyFileSync(path, join(dir, "full.mei"));
    const entry = { name, stem, measures: measures.length, full: `${stem}/full.mei`, slices: {} };
    const step = Math.max(1, Math.floor(measures.length / SLICE_SAMPLES));
    for (const win of WINDOWS) {
      entry.slices[win] = [];
      for (let k = 0; k < Math.min(SLICE_SAMPLES, measures.length); k++) {
        const idx = k * step;
        const xml = synthesizeSlice(scoreDef, measures.slice(idx, idx + win));
        const rel = `${stem}/slice-${win}_${idx}.mei`;
        writeFileSync(join(outRoot, rel), xml);
        entry.slices[win].push(rel);
      }
    }
    manifest.fixtures.push(entry);
  }
  writeFileSync(join(outRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
  return outRoot;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("wrote", makeSlices());
}
