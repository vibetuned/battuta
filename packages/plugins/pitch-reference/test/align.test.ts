/**
 * The two clocks and what was written: offset and rate invert, the offset
 * is found at the first real run of voiced frames, the timemap's notes
 * and measure windows come out engraved (clones mapped back, a repeated
 * measure's first pass), and the deviation is zero for a trace on the
 * notes and one semitone for one a semitone off.
 */
import { describe, it, expect } from "vitest";
import type { Timemap } from "@battuta/api";
import { detectOffsetMs, deviation, measureWindows, rateOf, toScoreMs, toWavMs, writtenNotes, type Alignment } from "../src/align";
import type { PitchFrame } from "../src/yin";

const TM: Timemap = {
  events: [
    { tstamp: 0, on: ["n1"], measureOn: "m1" },
    { tstamp: 500, off: ["n1"], on: ["n2", "n3"] },
    { tstamp: 1000, off: ["n2", "n3"], on: ["n4"], measureOn: "m2" },
    { tstamp: 2000, off: ["n4"], on: ["n1-rend2"], measureOn: "m1-rend2" },
    { tstamp: 2500, off: ["n1-rend2"] },
  ],
  notes: { n1: { pitch: 60, duration: 500 }, n2: { pitch: 64, duration: 500 }, n3: { pitch: 55, duration: 500 }, n4: { pitch: 67, duration: 1000 }, "n1-rend2": { pitch: 60, duration: 500 } },
  idMap: { "n1-rend2": "n1", "m1-rend2": "m1" },
};

const frame = (tMs: number, midi: number | null): PitchFrame => ({ t: tMs / 1000, midi, confidence: midi === null ? 0 : 0.9 });

describe("alignment", () => {
  it("offset and rate map score time to wav time and back", () => {
    const a: Alignment = { offsetMs: 300, rate: 0.5 };
    expect(toWavMs(a, 1000)).toBe(2300); // half speed: a score second takes two
    expect(toScoreMs(a, 2300)).toBe(1000);
    expect(rateOf(null, 120)).toBe(1);
    expect(rateOf(90, 120)).toBe(0.75);
    expect(rateOf(0, 120)).toBe(1);
  });

  it("finds the offset at the first run of voiced frames, a click skipped", () => {
    const frames = [frame(32, null), frame(42, 60), frame(52, null), frame(62, null), frame(272, 60), frame(282, 60.1), frame(292, 60), frame(302, 60)];
    expect(detectOffsetMs(frames)).toBe(240); // 272 − 32 (half a window)
    expect(detectOffsetMs([frame(32, null), frame(42, null)])).toBe(0);
    expect(detectOffsetMs([])).toBe(0);
  });

  it("lists the written notes with engraved ids and their measure", () => {
    const notes = writtenNotes(TM);
    expect(notes.map((n) => [n.id, n.fromMs, n.toMs, n.midi, n.measureId])).toEqual([
      ["n1", 0, 500, 60, "m1"],
      ["n2", 500, 1000, 64, "m1"],
      ["n3", 500, 1000, 55, "m1"],
      ["n4", 1000, 2000, 67, "m2"],
      ["n1", 2000, 2500, 60, "m1"], // the repeat pass, mapped back
    ]);
  });

  it("gives each measure its first window", () => {
    expect(measureWindows(TM)).toEqual([
      { id: "m1", fromMs: 0, toMs: 1000 },
      { id: "m2", fromMs: 1000, toMs: 2000 },
    ]);
  });

  it("measures the deviation of the trace from the written pitch through the alignment", () => {
    const notes = writtenNotes(TM);
    const a: Alignment = { offsetMs: 100, rate: 1 };
    const onPitch = [frame(150, 60), frame(350, 60.02), frame(700, 64), frame(1500, 67)];
    expect(deviation(onPitch, notes, a)).toEqual({ median: 0, compared: 4 }); // three exact, one 0.02 off: the median is exact
    const sharp = onPitch.map((f) => ({ ...f, midi: f.midi === null ? null : f.midi + 1 }));
    expect(deviation(sharp, notes, a)!.median).toBeCloseTo(1, 6);
    // a chord: the nearest written pitch counts
    const chord = deviation([frame(700, 55.1)], notes, a)!;
    expect(chord.compared).toBe(1);
    expect(chord.median).toBeCloseTo(0.1, 9);
    expect(deviation([frame(5000, 60)], notes, a)).toBeNull();
    expect(deviation([frame(150, null)], notes, a)).toBeNull();
  });
});
