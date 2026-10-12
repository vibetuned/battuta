/**
 * From annotation pixels to what is drawn. A page is rendered at its own
 * resolution and annotated at another (or the same): `scaleFor` maps one
 * to the other. A measure's CROP is its own width and its system's height
 * — every staff, so the scan above a tile shows what the tile shows — and
 * a band fits the crop to the tile's width, so the scan's barlines stand
 * over the tile's.
 */
import type { AnnotatedMeasure, AnnotatedPage, Box } from "./annotations";

/** Annotation pixels → rendered pixels for a page. */
export const scaleFor = (page: AnnotatedPage | undefined, renderedWidth: number): number => (page?.width ? renderedWidth / page.width : 1);

export function scaled(b: Box, s: number): Box {
  return { x0: b.x0 * s, y0: b.y0 * s, x1: b.x1 * s, y1: b.y1 * s };
}

/** The measure's width by its system's height (and the measure's own, where it reaches past it), in rendered pixels. */
export function cropOf(m: AnnotatedMeasure, s: number): Box {
  return scaled({ x0: m.box.x0, x1: m.box.x1, y0: Math.min(m.systemBox.y0, m.box.y0), y1: Math.max(m.systemBox.y1, m.box.y1) }, s);
}

/** A band is never taller than this many times the tile's width — a sliver of a measure in a tall system would otherwise push the row off screen. */
export const MAX_BAND_RATIO = 2.5;

/** The band height a crop asks for at a tile width: the crop fitted to the width. 0 for a degenerate crop. */
export function bandHeightFor(crop: Box, width: number): number {
  const w = crop.x1 - crop.x0;
  const h = crop.y1 - crop.y0;
  if (!(w > 0) || !(h > 0) || !(width > 0)) return 0;
  return Math.min((h * width) / w, width * MAX_BAND_RATIO);
}

/** What the panel's strip shows of a system: its box with a margin, kept inside the page. */
export function systemView(system: Box, s: number, page: { width: number; height: number }, margin = 10): Box {
  const b = scaled(system, s);
  return { x0: Math.max(0, b.x0 - margin), y0: Math.max(0, b.y0 - margin), x1: Math.min(page.width, b.x1 + margin), y1: Math.min(page.height, b.y1 + margin) };
}
