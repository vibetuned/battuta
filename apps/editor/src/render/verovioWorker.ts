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
  // data-n on layer groups drives the per-voice colors in the editor CSS.
  svgAdditionalAttribute: ["layer@n"],
};
const PAGE_OPTIONS = {
  breaks: "auto",
  // "auto" prints the meiHead title/composer as the page header (the
  // serialization must carry meiHead — serializeForPageView does).
  header: "auto",
  footer: "none",
  svgViewBox: true,
  scale: 40,
  pageHeight: 2970,
  pageWidth: 2100,
};

let toolkit: VerovioToolkit | null = null;
// "timemap" marks option state dirty (per-document expand), forcing the
// next ensureMode call to re-apply its option set.
let mode: "tile" | "page" | "timemap" = "tile";
let tileExtra = "{}"; // JSON of the current per-document tile option overrides

function ensureMode(m: "tile" | "page", extraJson = "{}") {
  if (!toolkit) throw new Error("message before init");
  if (mode !== m || (m === "tile" && extraJson !== tileExtra)) {
    toolkit.setOptions(m === "tile" ? { ...TILE_OPTIONS, ...JSON.parse(extraJson) } : PAGE_OPTIONS);
    mode = m;
    if (m === "tile") tileExtra = extraJson;
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
      ensureMode("tile", msg.optionsJson ?? "{}");
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
  } else if (msg.type === "timemap") {
    // Playback data for the page view: the timemap (one authoritative
    // timeline for audio AND highlight) plus per-note MIDI values — Verovio
    // resolves sounding pitch (key signature, measure accidentals, ties),
    // which the raw MEI attributes alone do not give. With an <expansion>
    // (repeats/voltas/jumps), repeated passes play as `<id>-rendN` clones:
    // idMap sends every clone back to its notated id for the highlight.
    try {
      toolkit!.setOptions({ ...PAGE_OPTIONS, expand: msg.expand ?? "" });
      mode = "timemap"; // option state is per-document now: force re-apply
      toolkit!.loadData(msg.xml);
      const events = toolkit!.renderToTimemap({ includeMeasures: true, includeRests: true }) as {
        tstamp: number;
        on?: string[];
        off?: string[];
        measureOn?: string;
      }[];
      const notes: Record<string, { pitch: number; duration: number }> = {};
      for (const ev of events) {
        for (const id of ev.on ?? []) {
          if (notes[id]) continue;
          const v = toolkit!.getMIDIValuesForElement(id);
          if (v && v.pitch > 0) notes[id] = { pitch: v.pitch, duration: v.duration };
        }
      }
      // expansionMap: id -> [notatedId, clones...]; keep non-identity only.
      const idMap: Record<string, string> = {};
      try {
        const em = toolkit!.renderToExpansionMap() as Record<string, string[]>;
        for (const [id, related] of Object.entries(em)) {
          const notated = related[0];
          if (notated && notated !== id) idMap[id] = notated;
        }
      } catch {
        /* no expansion loaded: identity map */
      }
      self.postMessage({ type: "timemapDone", id: msg.id, events, notes, idMap });
    } catch (err) {
      self.postMessage({ type: "timemapDone", id: msg.id, events: [], notes: {}, idMap: {}, error: String(err) });
    }
  }
};
