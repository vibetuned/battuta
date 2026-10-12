/**
 * One measure's scan, above its tile, in the band the host reserved: the
 * page image cropped to the measure's width and its system's height,
 * fitted to the cell — to the tile's width unless the band caps it — and
 * sat on the tile's top edge (bottom-aligned: the row's band is as tall as
 * its tallest scan).
 *
 * The crop is a box of EXACTLY the fitted size that hides what is outside
 * it, around an SVG whose view box has the crop's own aspect: an SVG view
 * box alone does not clip, and a cell taller than its scan showed the page
 * above the measure (the title, in the first shots of 2026-10-11).
 * Draw-only, like everything on the overlays point.
 */
import type { BandCell } from "@battuta/api";
import type { AnnotatedMeasure, Box } from "./annotations";
import type { RenderedPage } from "./pdf";

/** The crop's size inside a cell: as large as fits, aspect kept. */
export function fitted(crop: Box, cell: { width: number; height: number }): { width: number; height: number } {
  const w = crop.x1 - crop.x0;
  const h = crop.y1 - crop.y0;
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const k = Math.min(cell.width / w, cell.height / h);
  return { width: w * k, height: h * k };
}

export function ScanCell({ cell, crop, image, measure }: { cell: BandCell & { height: number }; crop: Box; image: RenderedPage; measure: AnnotatedMeasure }) {
  const size = fitted(crop, cell);
  return (
    <div
      data-pdf-scan={measure.id ?? ""}
      data-pdf-order={measure.order}
      data-pdf-page={measure.page}
      style={{ position: "absolute", left: 0, bottom: 0, width: size.width, height: size.height, overflow: "hidden" }}
    >
      <svg width={size.width} height={size.height} viewBox={`${crop.x0} ${crop.y0} ${crop.x1 - crop.x0} ${crop.y1 - crop.y0}`} preserveAspectRatio="none" style={{ display: "block" }}>
        <image href={image.url} x={0} y={0} width={image.width} height={image.height} preserveAspectRatio="none" />
      </svg>
    </div>
  );
}
