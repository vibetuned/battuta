/// <reference lib="webworker" />
/**
 * Web Worker hosting one Verovio toolkit instance.
 * Protocol:
 *   {type:"init"}                      -> {type:"ready", version}
 *   {type:"render", id, xml}           -> {type:"tile", id, svg, renderMs}
 *   {type:"renderPages", id, xml}      -> {type:"page", id, index, svg}…
 *                                         then {type:"pagesDone", id, pageCount}
 * Renders are serialized per worker; parallelism comes from the pool.
 */
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";

const TILE_OPTIONS = {
  breaks: "none",
  adjustPageWidth: true,
  adjustPageHeight: true,
  header: "none",
  footer: "none",
  // Tiles butt against each other horizontally: no side margins; generous
  // top margin absorbs tall elements (fermatas, ottavas) so staves align.
  pageMarginLeft: 0,
  pageMarginRight: 0,
  pageMarginTop: 100,
  pageMarginBottom: 20,
  svgViewBox: true,
  scale: 40,
  // Near-proportional duration spacing: equal durations get equal widths
  // across tiles, so joined measures read like one continuous system.
  spacingLinear: 0.03,
  spacingNonLinear: 1.0,
};
const PAGE_OPTIONS = {
  breaks: "auto",
  header: "none",
  footer: "none",
  svgViewBox: true,
  scale: 40,
  pageHeight: 2970,
  pageWidth: 2100,
};

let toolkit: VerovioToolkit | null = null;
let mode: "tile" | "page" = "tile";

function ensureMode(m: "tile" | "page") {
  if (!toolkit) throw new Error("message before init");
  if (mode !== m) {
    toolkit.setOptions(m === "tile" ? TILE_OPTIONS : PAGE_OPTIONS);
    mode = m;
  }
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === "init") {
    const mod = await createVerovioModule();
    toolkit = new VerovioToolkit(mod);
    toolkit.setOptions(TILE_OPTIONS);
    // Warm the font/glyph caches so the first real tile isn't 2-4x slower.
    toolkit.loadData(
      `<?xml version="1.0"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><music><body><mdiv><score><scoreDef><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef><section><measure n="1"><staff n="1"><layer n="1"><note pname="c" oct="4" dur="4"/></layer></staff></measure></section></score></mdiv></body></music></mei>`,
    );
    toolkit.renderToSVG(1);
    self.postMessage({ type: "ready", version: toolkit.getVersion() });
  } else if (msg.type === "render") {
    try {
      ensureMode("tile");
      const t0 = performance.now();
      if (!toolkit!.loadData(msg.xml)) throw new Error("verovio rejected slice");
      const svg = toolkit!.renderToSVG(1);
      self.postMessage({ type: "tile", id: msg.id, svg, renderMs: performance.now() - t0 });
    } catch (err) {
      self.postMessage({ type: "tile", id: msg.id, error: String(err), svg: "", renderMs: 0 });
    }
  } else if (msg.type === "renderPages") {
    ensureMode("page");
    toolkit!.loadData(msg.xml);
    const pageCount = toolkit!.getPageCount();
    for (let p = 1; p <= pageCount; p++) {
      self.postMessage({ type: "page", id: msg.id, index: p, svg: toolkit!.renderToSVG(p) });
    }
    self.postMessage({ type: "pagesDone", id: msg.id, pageCount });
  }
};
