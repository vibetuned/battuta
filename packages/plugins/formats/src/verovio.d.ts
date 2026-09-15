/**
 * Ambient types for the Verovio subpaths this plugin uses — the npm
 * package ships none for them, and a plugin cannot reach the editor's own
 * copy (`apps/editor/src/types/verovio.d.ts`, which types the RENDER
 * build for the tile and page pools).
 *
 * The duplication is forced by the boundary, and it is deliberately
 * NARROWER here: only the toolkit calls a CONVERTER makes. Engraving and
 * layout — `renderToSVG`, `renderToTimemap`, `getPageCount`, … — are the
 * host's render service, and leaving them undeclared means a slip is a
 * compile error before `plugin-boundaries`' rule 1b has to catch it.
 */
declare module "verovio/wasm-hum" {
  /** The Humdrum-enabled build (≈4.6 MB heavier than the render one; this plugin is the only reason it is in the bundle at all). */
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}

declare module "verovio/esm" {
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(options: Record<string, unknown>): void;
    /** Load source in the format `inputFrom` names. */
    loadData(data: string): boolean;
    /** Compressed MusicXML (.mxl zip) from raw bytes. */
    loadZipDataBuffer(data: ArrayBuffer): boolean;
    /** The loaded document as MEI — every import's target. */
    getMEI(options?: Record<string, unknown>): string;
    /** Standard MIDI file of the WRITTEN score, base64-encoded. */
    renderToMIDI(options?: Record<string, unknown>): string;
    /** Plaine & Easie code of the loaded document. */
    renderToPAE(): string;
    /** Humdrum kern of the loaded document (hum build only). */
    getHumdrum(): string;
  }
}
