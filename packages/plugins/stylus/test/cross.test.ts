/**
 * The cross's rulers: across, a cell for every length one drag step apart,
 * the input's over the landing point, the choice lit, the dots kept, all
 * above the staff and clear of its letters; down the landing's column, a
 * letter for every step at its height — lines left, spaces right — the
 * staff and a ledger line either side, stretching to the choice, the
 * choice lit with its octave. A chord has no ruler across.
 */
import { describe, it, expect } from "vitest";
import { STEP_X } from "../src/gesture";
import { CELL_H, noteGlyph, rulersOf, stepPitch, stepY } from "../src/Cross";

// A five-line staff, 12 px apart, its top line at 100 in the frame: a step is 6 px.
const LINES = [100, 112, 124, 136, 148];
// Treble: the pen landed on the middle line, B4 (step 4), at page x 500, from a quarter (index 4).
const LANDING = { step: 4, pitch: { pname: "b", oct: 4 } };
const g = (dur: "1" | "2" | "4" | "8" | "16" | "32" | "64", step: number, dots = 0, chord = false) => ({ choice: { dur, dots, step }, from: 4, chord });

describe("the notes and the letters", () => {
  it("engraves a length, its dots after it", () => {
    expect(noteGlyph({ dur: "4", dots: 0 })).toBe("\u{1D15F}");
    expect(noteGlyph({ dur: "8", dots: 1 })).toBe("\u{1D160}\u{1D16D}");
    expect(noteGlyph({ dur: "64", dots: 2 })).toBe("\u{1D163}\u{1D16D}\u{1D16D}");
  });

  it("steps a pitch letter by letter, the octave turning at C", () => {
    expect(stepPitch({ pname: "e", oct: 4 }, 1)).toEqual({ pname: "f", oct: 4 });
    expect(stepPitch({ pname: "b", oct: 4 }, 1)).toEqual({ pname: "c", oct: 5 });
    expect(stepPitch({ pname: "c", oct: 5 }, -1)).toEqual({ pname: "b", oct: 4 });
    expect(stepPitch({ pname: "b", oct: 4 }, -4)).toEqual({ pname: "e", oct: 4 });
    expect(stepPitch({ pname: "b", oct: 4 }, 9)).toEqual({ pname: "d", oct: 6 });
  });

  it("places a step on its staff", () => {
    expect(stepY(LINES, 0)).toBe(148);
    expect(stepY(LINES, 3)).toBe(130);
  });
});

describe("the ruler across", () => {
  it("is a cell for every length, one drag step apart, the input's over the landing point, the choice lit", () => {
    const r = rulersOf(500, LINES, LANDING, g("2", 4));
    expect(r.lengths.map((c) => c.dur)).toEqual(["64", "32", "16", "8", "4", "2", "1"]);
    expect(r.lengths.map((c) => c.x)).toEqual([-4, -3, -2, -1, 0, 1, 2].map((k) => 500 + k * STEP_X));
    expect(r.lengths.filter((c) => c.lit).map((c) => c.dur)).toEqual(["2"]);
    expect(r.lengths.find((c) => c.dur === "4")!.note).toBe("\u{1D15F}");
  });

  it("keeps the choice's dots on every cell", () => {
    expect(rulersOf(500, LINES, LANDING, g("4", 4, 1)).lengths.find((c) => c.dur === "8")!.note).toBe("\u{1D160}\u{1D16D}");
  });

  it("sits above the staff, clear of the letters above it — at the frame's top when there is no room", () => {
    const r = rulersOf(500, LINES, LANDING, g("4", 4));
    const highest = Math.min(...r.pills.map((p) => p.y));
    for (const c of r.lengths) expect(c.y + CELL_H).toBeLessThan(highest);
    expect(rulersOf(500, [10, 22, 34, 46, 58], LANDING, g("4", 4)).lengths[0]!.y).toBe(2);
  });

  it("is not there for a chord, whose length is the note's own", () => {
    expect(rulersOf(500, LINES, LANDING, g("4", 4, 0, true)).lengths).toEqual([]);
  });
});

describe("the ruler down", () => {
  it("is a letter for every step at its height, lines left of the column and spaces right", () => {
    const r = rulersOf(500, LINES, LANDING, g("4", 4));
    const bottom = r.pills.find((p) => p.step === 0)!;
    expect(bottom).toMatchObject({ text: "E", y: 148, lit: false });
    expect(bottom.x).toBeLessThan(500);
    expect(r.pills.find((p) => p.step === 1)!.x).toBeGreaterThan(500);
    expect(r.pills.find((p) => p.step === 8)).toMatchObject({ text: "F", y: 100 });
  });

  it("covers the staff and a ledger line either side, and stretches to the choice with a step to spare", () => {
    expect(rulersOf(500, LINES, LANDING, g("4", 4)).pills.map((p) => p.step)).toEqual([-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const high = rulersOf(500, LINES, LANDING, g("4", 13)).pills.map((p) => p.step);
    expect([high[0], high[high.length - 1]]).toEqual([-2, 14]);
  });

  it("sizes its letters to the staff: a space less a pixel, 9 to 13 px", () => {
    expect(rulersOf(500, LINES, LANDING, g("4", 4)).pill).toBe(11);
    expect(rulersOf(500, [100, 120, 140, 160, 180], LANDING, g("4", 4)).pill).toBe(13);
    expect(rulersOf(500, [100, 106, 112, 118, 124], LANDING, g("4", 4)).pill).toBe(9);
  });

  it("lights the choice with its octave", () => {
    const r = rulersOf(500, LINES, LANDING, g("4", 6));
    expect(r.pills.filter((p) => p.lit)).toEqual([expect.objectContaining({ step: 6, text: "D5" })]);
  });

  it("joins the ruler across: the column runs from under it to past the lowest letter", () => {
    const r = rulersOf(500, LINES, LANDING, g("4", 4));
    expect(r.column.x).toBe(500);
    expect(r.column.y1).toBe(r.lengths[0]!.y + CELL_H);
    expect(r.column.y2).toBeGreaterThan(Math.max(...r.pills.map((p) => p.y)));
  });
});
