/** Web Worker hosting a Verovio toolkit instance. */
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { TILE_OPTIONS, benchSlices, stats } from "./bench-lib.js";

let toolkit = null;

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    const t0 = performance.now();
    const mod = await createVerovioModule();
    toolkit = new VerovioToolkit(mod);
    toolkit.setOptions(TILE_OPTIONS);
    self.postMessage({ type: "ready", initMs: performance.now() - t0, version: toolkit.getVersion() });
  } else if (msg.type === "benchInWorker") {
    // Pure compute inside the worker, no transfer in the timings.
    const { times } = benchSlices(toolkit, msg.slices, msg.iters);
    self.postMessage({ type: "benchResult", stats: stats(times) });
  } else if (msg.type === "render") {
    // One render round-trip: main thread times send -> svg received.
    toolkit.loadData(msg.xml);
    const svg = toolkit.renderToSVG(1);
    self.postMessage({ type: "svg", svg, token: msg.token });
  }
};
