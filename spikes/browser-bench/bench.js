/**
 * Browser runner bench: WASM on the main thread vs WASM in a Web Worker.
 * Reports init cost, pure render cost, worker round-trip cost (includes
 * structured-clone transfer of the SVG), and a Tauri-IPC-shaped proxy
 * (JSON serialize + parse of the SVG payload).
 * Results land on window.__RESULTS__ for the Playwright driver.
 */
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { TILE_OPTIONS, benchSlices, stats, round2 } from "./bench-lib.js";

const log = (s) => {
  document.getElementById("log").textContent += s + "\n";
  console.log(s);
};
const ITERS = 8;
const results = { runner: "browser", ua: navigator.userAgent, groups: [] };

try {
  const manifest = await (await fetch("/manifest.json")).json();

  // --- Main thread toolkit ---
  let t0 = performance.now();
  const mod = await createVerovioModule();
  const toolkit = new VerovioToolkit(mod);
  toolkit.setOptions(TILE_OPTIONS);
  results.mainInitMs = round2(performance.now() - t0);
  results.verovio = toolkit.getVersion();
  log(`main-thread init: ${results.mainInitMs} ms (verovio ${results.verovio})`);

  // --- Worker toolkit ---
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  const workerMsg = () => new Promise((res) => (worker.onmessage = (e) => res(e.data)));
  t0 = performance.now();
  worker.postMessage({ type: "init" });
  const ready = await workerMsg();
  results.workerInitMs = round2(performance.now() - t0);
  results.workerInitInsideMs = round2(ready.initMs);
  log(`worker init: ${results.workerInitMs} ms total (${results.workerInitInsideMs} ms inside worker)`);

  for (const fx of manifest.fixtures) {
    for (const win of Object.keys(fx.slices)) {
      const sliceXmls = await Promise.all(fx.slices[win].map(async (rel) => (await fetch("/" + rel)).text()));
      const group = { fixture: fx.stem, window: Number(win) };

      // 1. Main thread pure render
      const mainRun = benchSlices(toolkit, sliceXmls, ITERS);
      group.main = stats(mainRun.times);
      group.svgKB = Math.round(mainRun.svg.length / 1024);

      // 2. Worker pure render (compute only, timed inside the worker)
      worker.postMessage({ type: "benchInWorker", slices: sliceXmls, iters: ITERS });
      group.workerCompute = (await workerMsg()).stats;

      // 3. Worker round-trip (loadData+render+clone SVG back), timed on main
      const rtTimes = [];
      for (const xml of sliceXmls) {
        for (let i = 0; i < ITERS; i++) {
          const t = performance.now();
          worker.postMessage({ type: "render", xml, token: i });
          await workerMsg();
          rtTimes.push(performance.now() - t);
        }
      }
      group.workerRoundTrip = stats(rtTimes);

      // 4. Tauri-IPC-shaped proxy: JSON serialize+parse the SVG payload
      const ipcTimes = [];
      for (let i = 0; i < 20; i++) {
        const t = performance.now();
        JSON.parse(JSON.stringify({ svg: mainRun.svg }));
        ipcTimes.push(performance.now() - t);
      }
      group.jsonIpcProxy = stats(ipcTimes);

      results.groups.push(group);
      log(`${fx.stem} [${win}m]: main p50 ${group.main.p50} | worker-rt p50 ${group.workerRoundTrip.p50} | svg ${group.svgKB} KB | json-proxy p50 ${group.jsonIpcProxy.p50}`);
    }
  }
  worker.terminate();
} catch (err) {
  results.error = String(err?.stack ?? err);
  log("ERROR: " + results.error);
}
window.__RESULTS__ = results;
