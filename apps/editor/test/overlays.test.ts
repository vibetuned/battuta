/**
 * The overlays point (slice 10a): the store, and the projection of
 * measured rectangles into a tile's own pixels — the pure half of
 * `<TileOverlays>`. The DOM half (the boxes read off a rendered tile, the
 * layer taking no pointer events, the re-measure on zoom, nothing mounted
 * while no overlay is registered) is `spikes/verify-overlays.mjs`, which
 * rehearses the point from a plugin that holds only `ctx`.
 */
import { describe, it, expect } from "vitest";
import type { StaffContext } from "@battuta/api";
import { OverlayStore, tileGeometry, type TileMeasurement } from "../src/host/overlays";

const ctx = (n: number): StaffContext => ({ n, lines: 5, clef: n === 1 ? { shape: "G", line: 2 } : { shape: "F", line: 4 }, keysig: "0", meter: { count: "4", unit: "4" } });

describe("OverlayStore", () => {
  it("adds, keys by plugin and id, disposes", () => {
    const store = new OverlayStore();
    const a = store.add({ id: "trace", render: () => null }, "p.one");
    const b = store.add({ id: "trace", render: () => null }, "p.two"); // another plugin, same id: both live
    expect(store.specs.get().map((s) => `${s.pluginId}:${s.id}`)).toEqual(["p.one:trace", "p.two:trace"]);
    a.dispose();
    a.dispose(); // twice is harmless
    expect(store.specs.get().map((s) => `${s.pluginId}:${s.id}`)).toEqual(["p.two:trace"]);
    b.dispose();
    expect(store.specs.get()).toEqual([]);
  });

  it("the same plugin adding the same id replaces the earlier overlay", () => {
    const store = new OverlayStore();
    const first = store.add({ id: "trace", render: () => "one" }, "p.one");
    store.add({ id: "trace", render: () => "two" }, "p.one");
    expect(store.specs.get().map((s) => s.render({ measureIndex: 0, measureId: null, width: 0, height: 0, boxes: {}, staves: [] }))).toEqual(["two"]);
    first.dispose(); // the replaced entry's disposable finds nothing to remove
    expect(store.specs.get()).toHaveLength(1);
  });
});

describe("tileGeometry", () => {
  const measured: TileMeasurement = {
    origin: { left: 100, top: 50, width: 200, height: 120 },
    events: [
      { id: "n1", rect: { left: 110, top: 60, width: 10, height: 8 } },
      { id: "r1", rect: { left: 250, top: 100, width: 6, height: 12 } },
    ],
    staves: [
      // staff 2 first in the DOM, its lines out of order — the answer is sorted both ways
      { id: "s2", lines: [{ left: 100, top: 120.5, width: 200, height: 1 }, { left: 100, top: 112.5, width: 200, height: 1 }, { left: 100, top: 116.5, width: 200, height: 1 }, { left: 100, top: 108.5, width: 200, height: 1 }, { left: 100, top: 104.5, width: 200, height: 1 }] },
      { id: "s1", lines: [60, 64, 68, 72, 76].map((top) => ({ left: 100, top: top + 0.5, width: 200, height: 1 })) },
      { id: "sX", lines: [{ left: 100, top: 90.5, width: 200, height: 1 }] }, // not a staff the document knows
    ],
  };
  const staffNOf = (id: string) => ({ s1: 1, s2: 2 } as Record<string, number>)[id];

  it("projects boxes into the tile's pixels and centres the staff lines, in staff order", () => {
    const g = tileGeometry(measured, staffNOf, ctx);
    expect(g.width).toBe(200);
    expect(g.height).toBe(120);
    expect(g.boxes).toEqual({ n1: { x: 10, y: 10, width: 10, height: 8 }, r1: { x: 150, y: 50, width: 6, height: 12 } });
    expect(g.staves.map((s) => s.n)).toEqual([1, 2]);
    expect(g.staves[0]!.lines).toEqual([11, 15, 19, 23, 27]);
    expect(g.staves[1]!.lines).toEqual([55, 59, 63, 67, 71]);
    expect(g.staves[0]!.context.clef.shape).toBe("G");
    expect(g.staves[1]!.context.clef.shape).toBe("F");
  });

  it("drops a staff whose number has no context in force", () => {
    const g = tileGeometry(measured, staffNOf, (n) => (n === 1 ? ctx(1) : undefined));
    expect(g.staves.map((s) => s.n)).toEqual([1]);
  });

  it("an empty tile has no boxes and no staves", () => {
    expect(tileGeometry({ origin: { left: 0, top: 0, width: 50, height: 40 }, events: [], staves: [] }, staffNOf, ctx)).toEqual({ width: 50, height: 40, boxes: {}, staves: [] });
  });
});
