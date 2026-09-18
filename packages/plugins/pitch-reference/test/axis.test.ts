/**
 * Pitch on the staff: the clef's line carries its pitch exactly, an
 * octave is 3½ spaces, the F and C clefs and the octave clefs read
 * right, a percussion clef gives no axis, and a fit through engraved
 * heads pulls the trace onto them (a fit that disagrees with the staff
 * is refused).
 */
import { describe, it, expect } from "vitest";
import type { OverlayStaff } from "@battuta/api";
import { clefPitch, fitAxis, staffAxis } from "../src/axis";

const staff = (shape: string, line: number, extra: Partial<OverlayStaff["context"]["clef"]> = {}): OverlayStaff => ({
  n: 1,
  lines: [10, 20, 30, 40, 50],
  context: { n: 1, lines: 5, clef: { shape, line, ...extra }, keysig: "0", meter: {} },
});

describe("pitch axis", () => {
  it("the clef puts its pitch on its line", () => {
    expect(clefPitch({ shape: "G", line: 2 })).toEqual({ midi: 67, line: 2 });
    expect(clefPitch({ shape: "F", line: 4 })).toEqual({ midi: 53, line: 4 });
    expect(clefPitch({ shape: "C", line: 3 })).toEqual({ midi: 60, line: 3 });
    expect(clefPitch({ shape: "G", line: 2, dis: 8, disPlace: "below" })).toEqual({ midi: 55, line: 2 });
    expect(clefPitch({ shape: "F", line: 4, dis: 15, disPlace: "above" })).toEqual({ midi: 77, line: 4 });
    expect(clefPitch({ shape: "perc", line: 3 })).toBeNull();
  });

  it("the treble staff: G4 on the second line, an octave 3½ spaces, decreasing y", () => {
    const a = staffAxis(staff("G", 2))!;
    expect(a.fit).toBe("clef");
    expect(a.yOf(67)).toBe(40);
    expect(a.yOf(79) - a.yOf(67)).toBeCloseTo(-35, 6);
    expect(a.yOf(60)).toBeGreaterThan(a.yOf(72));
    expect(a.midiOf(40)).toBeCloseTo(67, 9);
    expect(a.centre).toBeCloseTo(a.midiOf(30), 9);
    expect(a.perSemitone).toBeCloseTo((10 / 2) * (7 / 12), 9);
  });

  it("the bass and alto staves, and a staff without a pitched clef", () => {
    expect(staffAxis(staff("F", 4))!.yOf(53)).toBe(20);
    expect(staffAxis(staff("C", 3))!.yOf(60)).toBe(30);
    expect(staffAxis(staff("perc", 3))).toBeNull();
    expect(staffAxis({ ...staff("G", 2), lines: [10] })).toBeNull();
  });

  it("a fit through engraved heads lands the trace on them", () => {
    const base = staffAxis(staff("G", 2))!;
    // E4 (bottom line), G4, B4 (middle line), D5 — where the engraving really puts them
    const fitted = fitAxis(base, [
      { midi: 64, y: 50 },
      { midi: 67, y: 40 },
      { midi: 71, y: 30 },
      { midi: 74, y: 20 },
    ]);
    expect(fitted.fit).toBe("heads");
    expect(Math.abs(fitted.yOf(64) - 50)).toBeLessThan(1.5);
    expect(Math.abs(fitted.yOf(74) - 20)).toBeLessThan(1.5);
    expect(Math.abs(fitted.yOf(67) - 40)).toBeLessThan(1.5);
    // one head: the axis shifts to sit on it
    const one = fitAxis(base, [{ midi: 67, y: 43 }]);
    expect(one.fit).toBe("heads");
    expect(one.yOf(67)).toBe(43);
    expect(one.perSemitone).toBe(base.perSemitone);
    // heads from another staff (a slope four times the staff's): refused
    expect(fitAxis(base, [{ midi: 60, y: 200 }, { midi: 72, y: 60 }]).fit).toBe("clef");
    expect(fitAxis(base, [])).toBe(base);
  });
});
