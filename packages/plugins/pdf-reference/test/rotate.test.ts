/**
 * Turning a page: a box a quarter at a time (four are the box again), the
 * sizes, the annotations with one page turned — the same measure objects on
 * the page and in the list, the id map rebuilt — the files' frame, and a
 * drawing's page losing its systems.
 */
import { describe, expect, it } from "vitest";
import type { AnnotatedMeasure, Annotations } from "../src/annotations";
import { frameOf, rotateAnnotations, rotateBox, rotateDrawing, sizeAfter, turnAnnotations, turnsOf } from "../src/rotate";

const A4 = { width: 2100, height: 2970 };
const box = { x0: 200, y0: 100, x1: 1000, y1: 400 };

describe("turning a page", () => {
  it("a quarter clockwise sends (x, y) to (height − y, x); two are upside down; four are the box again", () => {
    expect(rotateBox(box, A4, 1)).toEqual({ x0: 2570, y0: 200, x1: 2870, y1: 1000 });
    expect(rotateBox(box, A4, 2)).toEqual({ x0: 1100, y0: 2570, x1: 1900, y1: 2870 });
    expect(rotateBox(box, A4, 3)).toEqual({ x0: 100, y0: 1100, x1: 400, y1: 1900 });
    expect(rotateBox(rotateBox(box, A4, 3), sizeAfter(A4, 3), 1)).toEqual(box);
    expect(sizeAfter(A4, 1)).toEqual({ width: 2970, height: 2100 });
    expect(sizeAfter(A4, 2)).toEqual(A4);
    expect([turnsOf(1), turnsOf(3), turnsOf(4), turnsOf("1"), turnsOf(undefined)]).toEqual([1, 3, 0, 0, 0]);
  });

  it("the annotations with one page turned: its boxes and sizes, the other page untouched, the measures the same objects in both places, the ids found", () => {
    const system = { x0: 40, y0: 100, x1: 2050, y1: 400 };
    const a: AnnotatedMeasure = { id: "a", page: 1, system: 0, box, systemBox: system, order: 0 };
    const b: AnnotatedMeasure = { id: "b", page: 2, system: 0, box, systemBox: system, order: 1 };
    const ann: Annotations = {
      pages: [
        { page: 1, width: 2100, height: 2970, systems: [system], staves: [[system]], measures: [a] },
        { page: 2, width: null, height: null, systems: [system], staves: [], measures: [b] },
      ],
      measures: [a, b],
      byId: new Map([["a", a], ["b", b]]),
    };
    const t = rotateAnnotations(ann, 1, A4, 1);
    expect(t.pages[0]).toMatchObject({ width: 2970, height: 2100, systems: [{ x0: 2570, y0: 40, x1: 2870, y1: 2050 }] });
    expect(t.pages[0]!.staves[0]![0]).toEqual({ x0: 2570, y0: 40, x1: 2870, y1: 2050 });
    expect(t.pages[0]!.measures[0]).toBe(t.measures[0]);
    expect(t.byId.get("a")).toBe(t.measures[0]);
    expect(t.measures[0]).toMatchObject({ id: "a", box: { x0: 2570, y0: 200, x1: 2870, y1: 1000 }, systemBox: { x0: 2570, y0: 40, x1: 2870, y1: 2050 } });
    expect(t.pages[1]).toBe(ann.pages[1]);
    expect(t.measures[1]).toBe(b);
    expect(rotateAnnotations(ann, 1, A4, 0)).toBe(ann);
    // The files' frame: their own size, else the rendered page's; a page without a size keeps none.
    expect(frameOf(ann.pages[0], { width: 10, height: 20 })).toEqual(A4);
    expect(frameOf(ann.pages[1], { width: 10, height: 20 })).toEqual({ width: 10, height: 20 });
    const all = turnAnnotations(ann, { "2": 2 }, () => A4);
    expect(all.pages[1]).toMatchObject({ width: null, height: null });
    expect(all.byId.get("b")!.box).toEqual({ x0: 1100, y0: 2570, x1: 1900, y1: 2870 });
  });

  it("a drawing's page turned: its size follows, its systems go, counted", () => {
    const d = { pages: { "1": { width: 2100, height: 2970, systems: [{ box, barlines: [500], splits: [] }, { box, barlines: [], splits: [] }] }, "2": { width: 2100, height: 2970, systems: [] } } };
    const r = rotateDrawing(d, 1, 1);
    expect(r.dropped).toBe(2);
    expect(r.drawing.pages["1"]).toEqual({ width: 2970, height: 2100, systems: [] });
    expect(r.drawing.pages["2"]).toBe(d.pages["2"]);
    expect(rotateDrawing(d, 3, 1)).toEqual({ drawing: d, dropped: 0 });
    expect(rotateDrawing(d, 1, 0)).toEqual({ drawing: d, dropped: 0 });
  });
});
