/**
 * The serial forms themselves — pure functions over PitchEvent[], no host
 * involved. The first four cases are the assertions core's old
 * reflect.test.ts made, carried over VERBATIM when the maths moved here:
 * the transforms are unchanged, only their address is.
 */
import { describe, it, expect } from "vitest";
import type { PitchEvent } from "@battuta/api";
import { reflectionForm, arityPalindromic, REFLECTION_CYCLE, REFLECTION_LABELS } from "../src/forms";

/** the user's own example: first note, +1, +2, +3, −2 (diatonic steps) */
const SEQ: PitchEvent[] = [
  { eventId: "r1", pitches: [{ pname: "c", oct: 4 }] },
  { eventId: "r2", pitches: [{ pname: "d", oct: 4 }] },
  { eventId: "r3", pitches: [{ pname: "e", oct: 4 }] },
  { eventId: "r4", pitches: [{ pname: "f", oct: 4 }] },
  { eventId: "r5", pitches: [{ pname: "a", oct: 3 }] },
];

const pitchesOf = (targets: PitchEvent[]): string[] => targets.map((t) => t.pitches.map((p) => `${p.pname}${p.oct}`).join("+"));

describe("the forms", () => {
  it("inversion mirrors diatonically about the first note", () => {
    // c4 anchor: +1→−1, +2→−2, +3→−3, −2→+2
    expect(pitchesOf(reflectionForm(SEQ, "inversion")!)).toEqual(["c4", "b3", "a3", "g3", "e4"]);
  });

  it("retrograde reverses pitch content over the fixed rhythm", () => {
    expect(pitchesOf(reflectionForm(SEQ, "retrograde")!)).toEqual(["a3", "f4", "e4", "d4", "c4"]);
  });

  it("retrograde inversion reverses the inversion", () => {
    expect(pitchesOf(reflectionForm(SEQ, "retrogradeInversion")!)).toEqual(["e4", "g3", "a3", "b3", "c4"]);
  });

  it("retrograde refuses when chord sizes don't mirror; inversion never does", () => {
    const mixed: PitchEvent[] = [
      { eventId: "c1", pitches: [{ pname: "c", oct: 4 }, { pname: "e", oct: 4 }] },
      { eventId: "n2", pitches: [{ pname: "g", oct: 4 }] },
    ];
    expect(reflectionForm(mixed, "retrograde")).toBeNull();
    expect(reflectionForm(mixed, "retrogradeInversion")).toBeNull();
    expect(reflectionForm(mixed, "inversion")).not.toBeNull();
  });

  it("event ids keep their positions — only content travels", () => {
    for (const form of REFLECTION_CYCLE) {
      const out = reflectionForm(SEQ, form);
      if (!out) continue;
      expect(out.map((t) => t.eventId)).toEqual(SEQ.map((t) => t.eventId));
    }
  });

  it("accidentals travel with their pitch", () => {
    const withAccid: PitchEvent[] = [
      { eventId: "a1", pitches: [{ pname: "c", oct: 4, accid: "s" }] },
      { eventId: "a2", pitches: [{ pname: "g", oct: 4 }] },
    ];
    const r = reflectionForm(withAccid, "retrograde")!;
    expect(r[0]!.pitches[0]).toEqual({ pname: "g", oct: 4 });
    expect(r[1]!.pitches[0]).toEqual({ pname: "c", oct: 4, accid: "s" });
  });

  it("prime returns the base unchanged, so the fourth press restores the document", () => {
    expect(pitchesOf(reflectionForm(SEQ, "prime")!)).toEqual(pitchesOf(SEQ));
  });

  it("refuses an empty sequence or an event with no pitches", () => {
    expect(reflectionForm([], "inversion")).toBeNull();
    expect(reflectionForm([{ eventId: "x", pitches: [] }], "inversion")).toBeNull();
  });

  it("chords invert note by note", () => {
    const chord: PitchEvent[] = [{ eventId: "c1", pitches: [{ pname: "c", oct: 4 }, { pname: "e", oct: 4 }] }];
    expect(pitchesOf(reflectionForm(chord, "inversion")!)).toEqual(["c4+a3"]);
  });
});

describe("the cycle's shape", () => {
  it("is four forms in press order, ending back at prime", () => {
    expect(REFLECTION_CYCLE).toEqual(["inversion", "retrograde", "retrogradeInversion", "prime"]);
  });

  it("labels every form (the notice text the user reads)", () => {
    for (const form of REFLECTION_CYCLE) expect(REFLECTION_LABELS[form]).toBeTruthy();
    expect(REFLECTION_LABELS.prime).toBe("back to the original");
  });

  it("arityPalindromic is what retrograde is gated on", () => {
    expect(arityPalindromic(SEQ)).toBe(true);
    expect(arityPalindromic([{ eventId: "a", pitches: [{ pname: "c", oct: 4 }, { pname: "e", oct: 4 }] }, { eventId: "b", pitches: [{ pname: "g", oct: 4 }] }])).toBe(false);
    // mirrors: 2 notes, 1 note, 2 notes
    expect(arityPalindromic([
      { eventId: "a", pitches: [{ pname: "c", oct: 4 }, { pname: "e", oct: 4 }] },
      { eventId: "b", pitches: [{ pname: "g", oct: 4 }] },
      { eventId: "c", pitches: [{ pname: "d", oct: 4 }, { pname: "f", oct: 4 }] },
    ])).toBe(true);
  });
});
