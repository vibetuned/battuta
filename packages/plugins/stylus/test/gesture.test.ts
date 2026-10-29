/**
 * The gesture as a pure function: the pen landing on a staff puts up the
 * cross at once, at the pitch under it and the input's length; a drag
 * steers it — right longer, left shorter, up and down by staff step on the
 * landing's staff — and lifting writes it, a changed length becoming the
 * input's; a tap is a lift where it landed. A stroke that lands off a
 * staff, or is cancelled, writes nothing.
 */
import { describe, it, expect } from "vitest";
import type { StylusEvent, StylusSample, StylusScorePoint } from "@battuta/api";
import { IDLE, STEP_X, lengthOf, lengthName, next, type Gesture, type Length } from "../src/gesture";

/** A point on staff 1 of measure 3, whose tile frame starts at page (100, 200). */
const point = (x: number, y: number, step: number, over: Partial<StylusScorePoint> = {}): StylusScorePoint => ({
  measureIndex: 2,
  staffN: 1,
  eventId: "n1",
  step,
  pitch: { pname: "cdefgab"[(((step + 2) % 7) + 7) % 7]!, oct: 4 + Math.floor((step + 2) / 7) }, // treble: step 0 is e4
  tile: { x: x - 100, y: y - 200 },
  ...over,
});
const sample = (x: number, y: number): StylusSample => [x, y, 0, 0.5, 1, 0, null];
const stroke = (phase: "down" | "move" | "up" | "cancel", id: number, x: number, y: number, at: StylusScorePoint | null): StylusEvent => ({ type: "stroke", phase, id, samples: [sample(x, y)], predicted: [], at });
const hold = (id: number, x: number, y: number): StylusEvent => ({ type: "hold", id, x, y, at: null });
const press = (button: "squeeze" | "side" | "doubleTap", phase: "down" | "up" | "tap" = "down"): StylusEvent => ({ type: "button", button, phase, x: null, y: null, height: null, at: null });
const down = stroke("down", 1, 150, 250, point(150, 250, 4));

/** Run events through the gesture from idle at an input length; the last state, every note written, every length set. */
function run(events: StylusEvent[], input: Length = { dur: "4", dots: 0 }) {
  let g: Gesture = IDLE;
  const written: unknown[] = [];
  const lengths: Length[] = [];
  for (const e of events) {
    const s = next(g, e, input);
    g = s.gesture;
    if (s.write) written.push(s.write);
    if (s.length) lengths.push(s.length);
  }
  return { g, written, lengths };
}

describe("the cross", () => {
  it("comes up as the pen lands, at the pitch under it and the input's length — no hold needed", () => {
    expect(run([down]).g).toMatchObject({ kind: "cross", choice: { dur: "4", dots: 0, step: 4, pitch: { pname: "b", oct: 4 } } });
    expect(run([down], { dur: "2", dots: 1 }).g).toMatchObject({ kind: "cross", choice: { dur: "2", dots: 1 } });
  });

  it("does not come up off a staff event or a pitch", () => {
    expect(run([stroke("down", 1, 150, 250, null)]).g).toEqual({ kind: "ignored", id: 1, armed: false });
    expect(run([stroke("down", 1, 150, 250, point(150, 250, 4, { eventId: null }))]).g).toEqual({ kind: "ignored", id: 1, armed: false });
    expect(run([stroke("down", 1, 150, 250, point(150, 250, 4, { pitch: null }))]).g).toEqual({ kind: "ignored", id: 1, armed: false });
    expect(run([stroke("down", 1, 150, 250, null), stroke("up", 1, 150, 250, null)]).written).toEqual([]);
  });

  it("steps the duration by drag across: right longer, left shorter, stopping at whole and 64th", () => {
    const at = (dx: number) => run([down, stroke("move", 1, 150 + dx, 250, point(150 + dx, 250, 4))]).g;
    expect(at(STEP_X)).toMatchObject({ choice: { dur: "2" } });
    expect(at(2 * STEP_X)).toMatchObject({ choice: { dur: "1" } });
    expect(at(9 * STEP_X)).toMatchObject({ choice: { dur: "1" } });
    expect(at(-STEP_X)).toMatchObject({ choice: { dur: "8" } });
    expect(at(-9 * STEP_X)).toMatchObject({ choice: { dur: "64" } });
    expect(at(STEP_X / 3)).toMatchObject({ choice: { dur: "4" } });
  });

  it("follows the pitch under the pen on the landing's staff, and keeps it off it", () => {
    const up = run([down, stroke("move", 1, 150, 235, point(150, 235, 7))]);
    expect(up.g).toMatchObject({ choice: { step: 7, pitch: { pname: "e", oct: 5 } } });
    // Another staff, or the same staff number a row further down: the pitch stays.
    const otherStaff = run([down, stroke("move", 1, 150, 235, point(150, 235, 7)), stroke("move", 1, 150, 300, point(150, 300, 2, { staffN: 2 }))]);
    expect(otherStaff.g).toMatchObject({ choice: { step: 7 } });
    const otherRow = run([down, stroke("move", 1, 150, 235, point(150, 235, 7)), stroke("move", 1, 150, 600, { ...point(150, 600, 3), tile: { x: 50, y: 100 } })]);
    expect(otherRow.g).toMatchObject({ choice: { step: 7 } });
    // A neighbouring measure in the same row: its tile's frame sits level, so it counts.
    const neighbour = run([down, stroke("move", 1, 400, 245, { ...point(400, 245, 5), measureIndex: 3, tile: { x: 20, y: 45 } })]);
    expect(neighbour.g).toMatchObject({ choice: { step: 5, dur: "1" } });
  });

  it("keeps the input's dots while the drag steps the duration", () => {
    const { written, lengths } = run([down, stroke("move", 1, 150 + STEP_X, 250, point(150 + STEP_X, 250, 4)), stroke("up", 1, 150 + STEP_X, 250, null)], { dur: "4", dots: 1 });
    expect(written).toEqual([{ type: "core.enterNote", eventId: "n1", pname: "b", oct: 4, dur: "2", dots: 1 }]);
    expect(lengths).toEqual([{ dur: "2", dots: 1 }]);
  });

  it("ignores the shell's hold, and another stroke's events", () => {
    const { g } = run([down, hold(1, 150, 250), stroke("up", 7, 150, 250, null), hold(7, 150, 250)]);
    expect(g).toMatchObject({ kind: "cross", choice: { dur: "4", step: 4 } });
  });
});

describe("lifting the pen", () => {
  it("on a tap, writes the input's length, dots and all, at the pitch under the pen over the event it landed on — the length unchanged", () => {
    const tap = [down, stroke("up", 1, 153, 251, point(153, 251, 4))];
    const { g, written, lengths } = run(tap, { dur: "8", dots: 0 });
    expect(written).toEqual([{ type: "core.enterNote", eventId: "n1", pname: "b", oct: 4, dur: "8" }]);
    expect(lengths).toEqual([]);
    expect(g).toEqual(IDLE);
    expect(run(tap, { dur: "4", dots: 1 }).written).toEqual([{ type: "core.enterNote", eventId: "n1", pname: "b", oct: 4, dur: "4", dots: 1 }]);
  });

  it("after a drag, writes the choice over the event it landed on and makes a changed length the input's", () => {
    const { written, lengths } = run([down, stroke("move", 1, 150 - STEP_X, 240, point(150 - STEP_X, 240, 6)), stroke("up", 1, 150 - STEP_X, 240, null)]);
    expect(written).toEqual([{ type: "core.enterNote", eventId: "n1", pname: "d", oct: 5, dur: "8" }]);
    expect(lengths).toEqual([{ dur: "8", dots: 0 }]);
    // A drag up and down alone changes the pitch, not the length.
    expect(run([down, stroke("move", 1, 150, 240, point(150, 240, 6)), stroke("up", 1, 150, 240, null)]).lengths).toEqual([]);
  });

  it("writes nothing when the stroke is cancelled", () => {
    expect(run([down, stroke("cancel", 1, 150, 250, null)])).toMatchObject({ g: IDLE, written: [] });
  });
});

describe("the input's length", () => {
  it("is read as the pen can write it, a quarter when it cannot, and named for the cross", () => {
    expect(lengthOf("8", 1)).toEqual({ dur: "8", dots: 1 });
    expect(lengthOf("breve", 0)).toEqual({ dur: "4", dots: 0 });
    expect(lengthOf("2", 5)).toEqual({ dur: "2", dots: 0 });
    expect([lengthName({ dur: "4", dots: 0 }), lengthName({ dur: "2", dots: 1 }), lengthName({ dur: "8", dots: 2 })]).toEqual(["quarter", "dotted half", "double-dotted eighth"]);
  });
});

describe("a chord", () => {
  it("is armed by the squeeze or the side button, and disarmed by a second press; the double-tap and the release do nothing", () => {
    expect(run([press("squeeze")]).g).toEqual({ kind: "idle", armed: true });
    expect(run([press("side")]).g).toEqual({ kind: "idle", armed: true });
    expect(run([press("squeeze"), press("squeeze", "up"), press("squeeze")]).g).toEqual({ kind: "idle", armed: false });
    expect(run([press("doubleTap", "tap")]).g).toEqual(IDLE);
  });

  it("makes the next stroke add the pitch under the pen to the note it lands on, at that note's length — and only that stroke", () => {
    const chord = run([press("squeeze"), down, stroke("move", 1, 150 + 3 * STEP_X, 235, point(150 + 3 * STEP_X, 235, 7))]);
    expect(chord.g).toMatchObject({ kind: "cross", chord: true, choice: { dur: "4", step: 7 } }); // across changes nothing
    const lifted = run([press("squeeze"), down, stroke("move", 1, 150, 235, point(150, 235, 7)), stroke("up", 1, 150, 235, null), stroke("down", 2, 150, 250, point(150, 250, 4)), stroke("up", 2, 150, 250, null)]);
    expect(lifted.written).toEqual([
      { type: "core.addChordNote", eventId: "n1", pname: "e", oct: 5 },
      { type: "core.enterNote", eventId: "n1", pname: "b", oct: 4, dur: "4" },
    ]);
    expect(lifted.lengths).toEqual([]);
  });

  it("arms the stroke on the glass when pressed during it (the S Pen's button held as it lands), and waits past a stroke that landed off a staff", () => {
    expect(run([down, press("side"), stroke("up", 1, 150, 250, null)]).written).toEqual([{ type: "core.addChordNote", eventId: "n1", pname: "b", oct: 4 }]);
    const past = run([press("squeeze"), stroke("down", 5, 10, 10, null), stroke("up", 5, 10, 10, null), down, stroke("up", 1, 150, 250, null)]);
    expect(past.written).toEqual([{ type: "core.addChordNote", eventId: "n1", pname: "b", oct: 4 }]);
  });
});
