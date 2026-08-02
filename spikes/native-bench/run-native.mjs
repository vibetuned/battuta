/**
 * Compile (if needed) and run the native Verovio bench on the shared slices.
 * Env VEROVIO_SRC must point at a verovio checkout with build/libverovio.so.
 * Writes spikes/out/native-results.json.
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeSlices } from "../lib/make-slices.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.VEROVIO_SRC;
if (!SRC || !existsSync(join(SRC, "build/libverovio.so"))) {
  console.error("Set VEROVIO_SRC to a verovio checkout containing build/libverovio.so");
  process.exit(2);
}

const bin = join(here, "bench");
const includes = ["include", "include/crc", "include/midi", "include/hum", "include/json", "include/pugi", "include/tuning-library", "include/zip", "include/vrv", "libmei/dist", "libmei/addons"].map((d) => `-I${join(SRC, d)}`);
console.log("compiling bench.cpp…");
execFileSync("g++", ["-O2", "-std=c++20", join(here, "bench.cpp"), ...includes, "-L", join(SRC, "build"), "-lverovio", `-Wl,-rpath,${join(SRC, "build")}`, "-o", bin], { stdio: "inherit" });

const slicesRoot = makeSlices();
const manifest = JSON.parse(readFileSync(join(slicesRoot, "manifest.json"), "utf8"));

const TILE_OPTIONS = JSON.stringify({
  breaks: "none", adjustPageWidth: true, adjustPageHeight: true, header: "none", footer: "none",
  pageMarginLeft: 20, pageMarginRight: 20, pageMarginTop: 20, pageMarginBottom: 20, svgViewBox: true, scale: 40,
});
const PAGE_OPTIONS = JSON.stringify({ breaks: "auto", header: "none", footer: "none", scale: 40 });
const ITERS = 8;

const run = (options, files) =>
  execFileSync(bin, [join(SRC, "data"), options, String(ITERS), ...files], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    .trim().split("\n").map((l) => JSON.parse(l));

const results = { runner: "native", groups: [] };
for (const fx of manifest.fixtures) {
  for (const win of Object.keys(fx.slices)) {
    const files = fx.slices[win].map((rel) => join(slicesRoot, rel));
    const perFile = run(TILE_OPTIONS, files);
    const all = perFile.flatMap((r) => [r.p50]); // per-file medians
    const p50 = all.sort((a, b) => a - b)[Math.floor(all.length / 2)];
    const worstP95 = Math.max(...perFile.map((r) => r.p95));
    results.groups.push({ fixture: fx.stem, window: Number(win), p50, worstP95, svgKB: Math.round(Math.max(...perFile.map((r) => r.svgBytes)) / 1024) });
    console.log(`${fx.stem} [${win}m]: native p50 ${p50} ms, worst p95 ${worstP95} ms`);
  }
  const [full] = run(PAGE_OPTIONS, [join(slicesRoot, fx.full)]);
  results.groups.push({ fixture: fx.stem, window: "full", p50: full.p50, worstP95: full.p95 });
  console.log(`${fx.stem} [full]: native load+render p50 ${full.p50} ms`);
}

writeFileSync(join(here, "../out/native-results.json"), JSON.stringify(results, null, 2));
console.log("wrote spikes/out/native-results.json");
