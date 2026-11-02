/**
 * Strokes into a symbol, as a pure function: a stroke's samples from down to
 * up, the clock started at the lift and stopped by the next landing; a
 * stroke near and soon enough joins the symbol, one far or late ends it and
 * starts another; the clock ending it; a stroke off the score and a cancel.
 */
import { describe, it, expect } from "vitest";
import type { StylusEvent, StylusScorePoint } from "@battuta/api";
import { GAP_MIN_SPACES, GAP_MS, GAP_RATIO, group, marginOf, near, tick, type Symbol, type Writing } from "../src/handwriting";

const at: StylusScorePoint = { measureIndex: 0, staffN: 1, eventId: "n1", step: 4, pitch: { pname: "b", oct: 4 }, tile: { x: 50, y: 50 }, staff: { space: 12, middleY: 250 }, measure: { left: 100, right: 400 }, nearestNote: null, nearestMark: null };
const stroke = (phase: "down" | "move" | "up" | "cancel", id: number, pts: [number, number][], on = true): StylusEvent => ({ type: "stroke", phase, id, samples: pts.map(([x, y]) => [x, y, 0, 0.5, 1, 0, null]), predicted: [], at: on ? at : null });

/** Events with their times; the writing afterwards and every symbol that ended. */
function run(events: [StylusEvent, number][], from: Writing | null = null) {
  let w = from;
  const done: Symbol[] = [];
  for (const [e, t] of events) {
    const g = group(w, e, t);
    w = g.writing;
    if (g.done) done.push(g.done);
  }
  return { w, done };
}

const first = (): Writing => run([[stroke("down", 1, [[150, 250]]), 0], [stroke("move", 1, [[152, 260], [154, 270]]), 16], [stroke("up", 1, [[155, 280]]), 40]]).w!;

describe("strokes into a symbol", () => {
  it("gathers a stroke's samples from down to up, boxes them, and starts the clock at the lift", () => {
    const w = first();
    expect(w).toMatchObject({ strokes: [[[150, 250], [152, 260], [154, 270], [155, 280]]], live: null, box: { minX: 150, maxX: 155, minY: 250, maxY: 280 }, deadline: 40 + GAP_MS, landing: { point: [150, 250], at } });
  });

  it("adds a stroke that lands near and in time to the symbol, the clock stopped while the pen is down", () => {
    const w = first();
    const down = run([[stroke("down", 2, [[160, 255]]), 300]], w);
    expect(down.done).toEqual([]);
    expect(down.w).toMatchObject({ strokes: w.strokes, live: { id: 2, points: [[160, 255]] }, deadline: null });
    const up = run([[stroke("up", 2, [[162, 240]]), 330]], down.w);
    expect(up.w).toMatchObject({ strokes: [w.strokes[0], [[160, 255], [162, 240]]], live: null, box: { minX: 150, maxX: 162, minY: 240, maxY: 280 }, deadline: 330 + GAP_MS });
  });

  it("ends the symbol when the next stroke lands too far or too late, and starts the next with it", () => {
    const w = first();
    // The first stroke is 30 px tall: its reach is half that, more than the half-space floor (6 px).
    const reach = marginOf(w.box, 12);
    expect(reach).toBe(GAP_RATIO * 30);
    const far = run([[stroke("down", 2, [[155 + reach + 1, 250]]), 300]], w);
    expect(far.done).toHaveLength(1);
    expect(far.done[0]).toMatchObject({ strokes: w.strokes, box: w.box });
    expect(far.w).toMatchObject({ strokes: [], live: { id: 2 }, landing: { point: [155 + reach + 1, 250] } });
    const late = run([[stroke("down", 2, [[160, 255]]), 40 + GAP_MS + 1]], w);
    expect(late.done).toHaveLength(1);
    expect(run([[stroke("down", 2, [[155 + reach, 250]]), 40 + GAP_MS]], w).done).toEqual([]); // at the edge, still the same symbol
  });

  it("keeps the page origin of every tile the pen crosses, for the ink to show all over the row", () => {
    const next: StylusScorePoint = { ...at, measureIndex: 1, tile: { x: 10, y: 30 } };
    const w = run([[stroke("down", 1, [[150, 250]]), 0], [{ ...stroke("move", 1, [[260, 240]]), at: next }, 16], [{ ...stroke("up", 1, [[270, 245]]), at: next }, 40]]).w!;
    expect(w.origins).toEqual({ 0: [150 - at.tile.x, 250 - at.tile.y], 1: [250, 210] });
    // A stroke of the same symbol landing on a third tile adds it; one on a known tile changes nothing.
    const third: StylusScorePoint = { ...at, measureIndex: 2, tile: { x: 0, y: 0 } };
    const more = run([[{ ...stroke("down", 2, [[275, 250]]), at: third }, 100], [stroke("up", 2, [[276, 250]]), 130]], w).w!;
    expect(Object.keys(more.origins)).toEqual(["0", "1", "2"]);
    expect(more.origins[2]).toEqual([275, 250]);
  });

  it("reaches no further than half a space from a small symbol, so a dot after a dot on the next note is its own", () => {
    // A dot: a box of one point, reach = the floor.
    const dot = run([[stroke("down", 1, [[150, 250]]), 0], [stroke("up", 1, [[151, 251]]), 30]]).w!;
    expect(marginOf(dot.box, 12)).toBe(GAP_MIN_SPACES * 12);
    expect(run([[stroke("down", 2, [[151 + 6, 250]]), 100]], dot).done).toEqual([]);
    const next = run([[stroke("down", 2, [[151 + 7, 250]]), 100]], dot);
    expect(next.done).toHaveLength(1);
    expect(next.w).toMatchObject({ strokes: [], live: { id: 2 }, landing: { point: [158, 250] } });
    // A sharp's second vertical, a space right of its first (3 spaces tall), joins it.
    const bar = run([[stroke("down", 1, [[150, 250]]), 0], [stroke("up", 1, [[150, 286]]), 30]]).w!;
    expect(run([[stroke("down", 2, [[162, 250]]), 100]], bar).done).toEqual([]);
  });

  it("ends the symbol when the clock runs out, not before, and never while the pen is down", () => {
    const w = first();
    expect(tick(w, w.deadline! - 1)).toEqual({ writing: w });
    expect(tick(w, w.deadline!)).toMatchObject({ writing: null, done: { strokes: w.strokes } });
    const down = run([[stroke("down", 2, [[160, 255]]), 300]], w).w;
    expect(tick(down, 10_000)).toEqual({ writing: down });
    expect(tick(null, 10_000)).toEqual({ writing: null });
  });

  it("takes a tap as a symbol of one point", () => {
    const w = run([[stroke("down", 1, [[150, 250]]), 0], [stroke("up", 1, [[150, 250]]), 30]]).w;
    expect(tick(w, 30 + GAP_MS).done).toMatchObject({ strokes: [[[150, 250], [150, 250]]], box: { minX: 150, maxX: 150 } });
  });

  it("ignores a stroke that lands off the score, drops a cancelled stroke, and keeps what was written before it", () => {
    expect(run([[stroke("down", 1, [[150, 250]], false), 0], [stroke("up", 1, [[150, 250]], false), 30]]).w).toBeNull();
    expect(run([[stroke("down", 1, [[150, 250]]), 0], [stroke("cancel", 1, [[150, 250]]), 30]]).w).toBeNull();
    const w = first();
    const cancelled = run([[stroke("down", 2, [[160, 255]]), 300], [stroke("cancel", 2, [[160, 255]]), 320]], w).w;
    expect(cancelled).toMatchObject({ strokes: w.strokes, live: null, deadline: 320 + GAP_MS });
    // Another stroke's moves and lifts are not this symbol's.
    expect(run([[stroke("move", 9, [[200, 200]]), 50]], w).w).toBe(w);
  });

  it("measures nearness as a margin around the box", () => {
    const box = { minX: 100, maxX: 110, minY: 200, maxY: 220 };
    expect(near(box, [95, 200], 5)).toBe(true);
    expect(near(box, [94, 200], 5)).toBe(false);
    expect(near(box, [105, 226], 5)).toBe(false);
  });
});
