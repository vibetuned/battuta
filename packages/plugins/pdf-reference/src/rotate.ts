/**
 * Turning a page (the user, 2026-11-05: "a button to be able to rotate the
 * reference considering landscape and reversed images"). A scan on its side
 * or upside down is turned a quarter clockwise at a time, and everything
 * placed on it turns with it: the page image itself (`rotatePage`, a lossless
 * quarter turn through a canvas — no original is kept, four turns are the
 * page again), the annotation files' boxes (`rotateAnnotations`, in their own
 * frame: the annotated size, or the rendered page's when the files give
 * none), and a drawing's page size. A drawing's systems do not survive a turn
 * — a system is a horizontal box with vertical barlines, and every tap is a
 * quarter — so they go, counted, and the page is drawn again upright. The
 * turns are kept with the PDF's drawing (`Drawing.rotations`) and given back
 * to its pages when it is loaded again; a drawing is in the turned page's
 * pixels, so it needs nothing more.
 */
import type { AnnotatedMeasure, AnnotatedPage, Annotations, Box } from "./annotations";
import type { Drawing } from "./drawing";
import type { RenderedPage } from "./pdf";

/** Quarter turns clockwise a page has been given: 0, 1, 2 (upside down) or 3. */
export type Turns = 0 | 1 | 2 | 3;

export interface Size {
  width: number;
  height: number;
}

export const turnsOf = (raw: unknown): Turns => (raw === 1 || raw === 2 || raw === 3 ? raw : 0);

export const addTurns = (a: Turns, b: Turns): Turns => ((a + b) % 4) as Turns;

/** A page's size after the turns: the sides swap on a quarter. */
export const sizeAfter = (size: Size, turns: Turns): Size => (turns % 2 === 1 ? { width: size.height, height: size.width } : { width: size.width, height: size.height });

/** A box in a page of `size`, after the page turned `turns` quarters clockwise: a quarter sends (x, y) to (height − y, x). */
export function rotateBox(b: Box, size: Size, turns: Turns): Box {
  let box = b;
  let s = size;
  for (let i = 0; i < turns; i++) {
    box = { x0: s.height - box.y1, y0: box.x0, x1: s.height - box.y0, y1: box.x1 };
    s = sizeAfter(s, 1);
  }
  return box;
}

/** The frame an annotated page's boxes are in: the size the files gave, else the rendered page's. */
export const frameOf = (page: AnnotatedPage | undefined, rendered: Size): Size => (page && page.width !== null && page.height !== null ? { width: page.width, height: page.height } : rendered);

/** The annotations with one page turned: its sizes and every box; the measures stay the same objects on the page and in the list, the id map rebuilt. */
export function rotateAnnotations(ann: Annotations, page: number, frame: Size, turns: Turns): Annotations {
  if (turns === 0) return ann;
  const turned = new Map<AnnotatedMeasure, AnnotatedMeasure>();
  const size = sizeAfter(frame, turns);
  const pages = ann.pages.map((p) => {
    if (p.page !== page) return p;
    const measures = p.measures.map((m) => {
      const t: AnnotatedMeasure = { ...m, box: rotateBox(m.box, frame, turns), systemBox: rotateBox(m.systemBox, frame, turns) };
      turned.set(m, t);
      return t;
    });
    return {
      ...p,
      width: p.width === null ? null : size.width,
      height: p.height === null ? null : size.height,
      systems: p.systems.map((b) => rotateBox(b, frame, turns)),
      staves: p.staves.map((row) => row.map((b) => rotateBox(b, frame, turns))),
      measures,
    };
  });
  const measures = ann.measures.map((m) => turned.get(m) ?? m);
  const byId = new Map<string, AnnotatedMeasure>();
  for (const m of measures) if (m.id !== null && !byId.has(m.id)) byId.set(m.id, m);
  return { pages, measures, byId };
}

/** Annotations read from files, turned as their pages are; `rendered` gives each page's size before its turn. */
export function turnAnnotations(ann: Annotations, rotations: Readonly<Record<string, Turns>>, rendered: (page: number) => Size | undefined): Annotations {
  let out = ann;
  for (const p of ann.pages) {
    const turns = turnsOf(rotations[String(p.page)]);
    const size = rendered(p.page);
    if (turns && size) out = rotateAnnotations(out, p.page, frameOf(p, size), turns);
  }
  return out;
}

/** A drawing with one page turned: the page's size follows; its systems go — they would be sideways — counted for a word to the user. */
export function rotateDrawing(d: Drawing, page: number, turns: Turns): { drawing: Drawing; dropped: number } {
  const p = d.pages[String(page)];
  if (!p || turns === 0) return { drawing: d, dropped: 0 };
  const size = sizeAfter(p, turns);
  return { drawing: { ...d, pages: { ...d.pages, [String(page)]: { width: size.width, height: size.height, systems: [] } } }, dropped: p.systems.length };
}

/** The page image turned, a new blob URL for the old one (released). A quarter turn through a canvas loses nothing. */
export async function rotatePage(page: RenderedPage, turns: Turns): Promise<RenderedPage> {
  if (turns === 0) return page;
  const blob = await (await fetch(page.url)).blob();
  const bitmap = await createImageBitmap(blob);
  const size = sizeAfter(page, turns);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("this platform cannot turn a page");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((turns * Math.PI) / 2);
  context.drawImage(bitmap, -page.width / 2, -page.height / 2);
  bitmap.close();
  const out = await canvas.convertToBlob({ type: "image/png" });
  URL.revokeObjectURL(page.url);
  return { page: page.page, url: URL.createObjectURL(out), width: canvas.width, height: canvas.height };
}
