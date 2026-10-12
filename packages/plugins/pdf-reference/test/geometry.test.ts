/**
 * From annotation pixels to what is drawn: the page's scale, a measure's
 * crop (its width, its system's height, and its own where it reaches past
 * it), the band a crop asks for at a tile width — fitted, capped,
 * degenerate — the strip's view, and the scan's fit inside a cell.
 */
import { describe, it, expect } from "vitest";
import { bandHeightFor, cropOf, MAX_BAND_RATIO, scaleFor, systemView } from "../src/geometry";
import { fitted } from "../src/ScanCell";
import type { AnnotatedMeasure } from "../src/annotations";

const measure = (box: [number, number, number, number], systemBox: [number, number, number, number]): AnnotatedMeasure => ({
  id: "m",
  page: 1,
  system: 0,
  order: 0,
  box: { x0: box[0], y0: box[1], x1: box[2], y1: box[3] },
  systemBox: { x0: systemBox[0], y0: systemBox[1], x1: systemBox[2], y1: systemBox[3] },
});

describe("geometry", () => {
  it("scales annotation pixels to the rendered page", () => {
    expect(scaleFor({ page: 1, width: 2100, height: 2970, systems: [], staves: [], measures: [] }, 1050)).toBe(0.5);
    expect(scaleFor({ page: 1, width: null, height: null, systems: [], staves: [], measures: [] }, 1050)).toBe(1);
    expect(scaleFor(undefined, 1050)).toBe(1);
  });

  it("a crop is the measure's width by its system's height — and the measure's own where it reaches past", () => {
    expect(cropOf(measure([300, 120, 700, 380], [40, 100, 2000, 400]), 1)).toEqual({ x0: 300, y0: 100, x1: 700, y1: 400 });
    expect(cropOf(measure([300, 80, 700, 420], [40, 100, 2000, 400]), 0.5)).toEqual({ x0: 150, y0: 40, x1: 350, y1: 210 });
  });

  it("a band fits the crop to the tile's width, capped, and asks nothing of a degenerate crop", () => {
    const crop = { x0: 0, y0: 0, x1: 400, y1: 300 };
    expect(bandHeightFor(crop, 200)).toBe(150);
    expect(bandHeightFor({ x0: 0, y0: 0, x1: 10, y1: 300 }, 200)).toBe(200 * MAX_BAND_RATIO);
    expect(bandHeightFor({ x0: 0, y0: 0, x1: 0, y1: 300 }, 200)).toBe(0);
    expect(bandHeightFor(crop, 0)).toBe(0);
  });

  it("the strip shows the system with a margin, inside the page", () => {
    expect(systemView({ x0: 5, y0: 100, x1: 2095, y1: 400 }, 1, { width: 2100, height: 2970 })).toEqual({ x0: 0, y0: 90, x1: 2100, y1: 410 });
  });

  it("a scan fills its cell as far as its aspect lets it", () => {
    expect(fitted({ x0: 0, y0: 0, x1: 400, y1: 300 }, { width: 200, height: 300 })).toEqual({ width: 200, height: 150 });
    expect(fitted({ x0: 0, y0: 0, x1: 100, y1: 400 }, { width: 200, height: 200 })).toEqual({ width: 50, height: 200 });
    expect(fitted({ x0: 0, y0: 0, x1: 0, y1: 0 }, { width: 200, height: 200 })).toEqual({ width: 0, height: 0 });
  });
});
