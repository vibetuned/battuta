/**
 * Minimal ambient types for verovio's subpath exports (the npm package ships
 * none for them). Only the surface battuta uses; extend as needed.
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
    renderToSVG(page?: number): string;
    getPageCount(): number;
    getVersion(): string;
    renderToTimemap(options?: Record<string, unknown>): unknown[];
    getElementsAtTime(ms: number): unknown;
    getMIDIValuesForElement(xmlId: string): { time: number; pitch: number; duration: number };
    renderToExpansionMap(): Record<string, string[]>;
    select(selection: Record<string, unknown>): boolean;
  }
}
