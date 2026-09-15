/**
 * Minimal ambient types for verovio's subpath exports (the npm package ships
 * none for them). Only the surface the HOST uses: the render build and the
 * engraving half of the toolkit. The Humdrum-enabled build and the
 * conversion calls left with the converters in slice 8b — they are declared
 * in `packages/plugins/formats/src/verovio.d.ts`, and more narrowly.
 */
declare module "verovio/wasm" {
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}

declare module "verovio/esm" {
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): boolean;
    /** Compressed MusicXML (.mxl zip) from raw bytes. */
    loadZipDataBuffer(data: ArrayBuffer): boolean;
    renderToSVG(page?: number): string;
    getPageCount(): number;
    getVersion(): string;
    renderToTimemap(options?: Record<string, unknown>): unknown[];
    getElementsAtTime(ms: number): unknown;
    getMIDIValuesForElement(xmlId: string): { time: number; pitch: number; duration: number };
    renderToExpansionMap(): Record<string, string[]>;
    select(selection: Record<string, unknown>): boolean;
    /** The loaded document as MEI (conversion target). */
    getMEI(options?: Record<string, unknown>): string;
    /** Standard MIDI file, base64-encoded. */
    renderToMIDI(options?: Record<string, unknown>): string;
    /** Plaine & Easie code of the loaded document. */
    renderToPAE(): string;
    /** Humdrum kern of the loaded document (hum build only). */
    getHumdrum(): string;
  }
}
