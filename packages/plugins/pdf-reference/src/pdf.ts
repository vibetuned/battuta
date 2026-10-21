/**
 * The PDF, rasterized: every page rendered ONCE, at 254 dpi (the
 * resolution the example annotations were made at — 2100 px across A4),
 * into an image the bands and the panel crop with SVG view boxes, so no
 * measure is ever drawn twice. The library (pdf.js) is imported here and
 * nowhere else, dynamically: it is fetched the first time a PDF is loaded,
 * not when the plugin wakes. Rendering uses an OffscreenCanvas — a plugin
 * never touches the document — and the image is a blob URL the plugin
 * revokes when the PDF is cleared.
 */
export interface RenderedPage {
  /** 1-based. */
  page: number;
  /** A blob URL of the page image. */
  url: string;
  /** The image's size in pixels. */
  width: number;
  height: number;
}

/** Points to pixels: 254 dpi. */
export const RENDER_SCALE = 254 / 72;

export interface RenderHooks {
  progress?: (done: number, total: number) => void;
  /** True when the caller no longer wants the result (a newer load, a clear): rendering stops between pages. */
  cancelled?: () => boolean;
}

/**
 * What pdf.js (6.4) calls with no fallback, checked before it loads: on a
 * system without one of them a PDF fails half-way — `Promise.try` carries
 * every message to the worker, `Math.sumPrecise` rebuilds embedded fonts.
 * Safari has them all from 26.2 (MDN and caniuse, checked 2026-10-21), so
 * an older iPhone or iPad says so rather than failing; the PDF's pages as
 * images need none of them. Empty where PDFs work.
 */
export function pdfMissing(): string[] {
  const has = (owner: object, name: string): boolean => typeof (owner as Record<string, unknown>)[name] === "function";
  const needs: [string, boolean][] = [
    ["Promise.withResolvers", has(Promise, "withResolvers")],
    ["Promise.try", has(Promise, "try")],
    ["URL.parse", has(URL, "parse")],
    ["Uint8Array.fromBase64", has(Uint8Array, "fromBase64")],
    ["Math.sumPrecise", has(Math, "sumPrecise")],
  ];
  return needs.filter(([, ok]) => !ok).map(([name]) => name);
}

/** What the panel says where `pdfMissing()` is not empty. */
export const PDF_NEEDS = "Reading a PDF needs iOS / iPadOS 26.2 or later on an iPhone or iPad (a current browser elsewhere); the PDF's pages as images work on this one.";

let workerStarted = false;

export async function renderPdf(bytes: ArrayBuffer, hooks: RenderHooks = {}): Promise<RenderedPage[]> {
  const pdfjs = await import("pdfjs-dist");
  if (!workerStarted) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("./pdfWorker.ts", import.meta.url), { type: "module" });
    workerStarted = true;
  }
  // The loading task owns the document: destroying it (below) releases the
  // document in the worker and keeps our worker port for the next PDF.
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const doc = await task.promise;
  const pages: RenderedPage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      if (hooks.cancelled?.()) break;
      hooks.progress?.(n - 1, doc.numPages);
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      // ROUND, not ceil: A4 at 254 dpi is 2100.0000x px in floating point,
      // and a pixel too many puts every crop a hair off the annotations.
      const canvas = new OffscreenCanvas(Math.round(viewport.width), Math.round(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("this platform cannot draw a PDF page");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, canvas: null, viewport }).promise;
      const blob = await canvas.convertToBlob({ type: "image/png" });
      pages.push({ page: n, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height });
      page.cleanup();
    }
    hooks.progress?.(doc.numPages, doc.numPages);
  } finally {
    await task.destroy();
  }
  return pages;
}

/** Give the page images back. */
export function releasePages(pages: readonly RenderedPage[]): void {
  for (const p of pages) URL.revokeObjectURL(p.url);
}
