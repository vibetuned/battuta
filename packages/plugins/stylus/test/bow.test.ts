/**
 * The bow as pure functions: the note under the pen (within a space of its
 * body), a tie for the same written pitch and a slur otherwise, and the
 * stroke events into a bow — started on a note, ended by the lift with the
 * note under it, or none.
 */
import { describe, it, expect } from "vitest";
import type { StylusEvent, StylusScorePoint } from "@battuta/api";
import { BOW_REACH, bowKind, bowStep, boxOf, touching } from "../src/bow";

/** A stem-up note: its head at (x, y), its body 1.3 spaces wide and 4 tall, of 10 px spaces. */
const note = (eventId: string, x: number, y: number, pitch: StylusScorePoint["pitch"] = { pname: "c", oct: 4 }) => ({ eventId, x, y, box: { left: x - 6.5, top: y - 35, right: x + 6.5, bottom: y + 5 }, pitch });
const at = (nearestNote: ReturnType<typeof note> | null): StylusScorePoint => ({ measureIndex: 0, staffN: 1, eventId: "n1", step: 4, pitch: { pname: "b", oct: 4 }, tile: { x: 0, y: 0 }, staff: { space: 10, middleY: 300 }, measure: { left: 100, right: 500 }, nearestNote, nearestMark: null });
const stroke = (phase: "down" | "move" | "up" | "cancel", id: number, points: [number, number][], point: StylusScorePoint | null): StylusEvent => ({ type: "stroke", phase, id, samples: points.map(([x, y]) => [x, y, 0, 0.5, 1, 0, null] as const), predicted: [], at: point });

describe("the note under the pen", () => {
  it("is the nearest note when the point is within a space of its body, stem included", () => {
    const n = note("n1", 300, 300);
    expect(touching(at(n), [300, 300])).toBe(n);
    expect(touching(at(n), [300, 270])).toBe(n); // on the stem
    expect(touching(at(n), [316, 300])).toBe(n); // a space right of the head
    expect(touching(at(n), [317, 300])).toBeNull();
    expect(touching(at(n), [300, 316])).toBeNull();
    expect(touching(at(null), [300, 300])).toBeNull();
    expect(touching(null, [300, 300])).toBeNull();
    expect(BOW_REACH).toBe(1);
  });
});

describe("tie or slur", () => {
  it("is a tie for the same written pitch, accidental included, a slur for anything else or an unknown pitch", () => {
    const c = note("a", 300, 300);
    expect(bowKind(c, note("b", 400, 300))).toBe("tie");
    expect(bowKind(c, note("b", 400, 300, { pname: "d", oct: 4 }))).toBe("slur");
    expect(bowKind(c, note("b", 400, 300, { pname: "c", oct: 5 }))).toBe("slur");
    expect(bowKind(c, note("b", 400, 300, { pname: "c", oct: 4, accid: "s" }))).toBe("slur");
    expect(bowKind(note("a", 300, 300, { pname: "c", oct: 4, accid: "s" }), note("b", 400, 300, { pname: "c", oct: 4, accid: "s" }))).toBe("tie");
    expect(bowKind(c, note("b", 400, 300, null))).toBe("slur");
  });
});

describe("the stroke into a bow", () => {
  it("starts on a note, grows with the moves, ends with the note under the lift — or none", () => {
    const n1 = note("n1", 300, 300), n2 = note("n2", 400, 300);
    expect(bowStep(null, stroke("down", 1, [[200, 300]], at(null))).bow).toBeNull();
    expect(bowStep(null, stroke("down", 1, [[200, 300]], null)).bow).toBeNull();
    const down = bowStep(null, stroke("down", 1, [[300, 300]], at(n1))).bow!;
    expect(down).toMatchObject({ id: 1, from: n1, points: [[300, 300]], landing: { point: [300, 300] } });
    expect(down.origins).toEqual({ 0: [300, 300] });
    const moved = bowStep(down, stroke("move", 1, [[340, 280], [360, 280]], { ...at(null), measureIndex: 1, tile: { x: 60, y: 80 } })).bow!;
    expect(moved.points).toEqual([[300, 300], [340, 280], [360, 280]]);
    expect(moved.origins).toEqual({ 0: [300, 300], 1: [300, 200] }); // the next tile's origin, from the last sample on it
    expect(bowStep(moved, stroke("move", 2, [[0, 0]], null)).bow).toBe(moved); // another stroke's event
    const up = bowStep(moved, stroke("up", 1, [[400, 300]], at(n2)));
    expect(up.bow).toBeNull();
    expect(up.done).toMatchObject({ from: n1, to: n2, points: [[300, 300], [340, 280], [360, 280], [400, 300]] });
    expect(bowStep(moved, stroke("up", 1, [[450, 300]], at(null))).done).toMatchObject({ to: null });
    expect(bowStep(moved, stroke("cancel", 1, [], null))).toEqual({ bow: null });
    expect(bowStep(moved, { type: "hover", phase: "move", x: 0, y: 0, height: 0.5, at: null })).toEqual({ bow: moved });
    expect(boxOf([[300, 300], [340, 280], [400, 310]])).toEqual({ minX: 300, maxX: 400, minY: 280, maxY: 310 });
  });
});
