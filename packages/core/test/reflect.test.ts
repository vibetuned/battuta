import { describe, it, expect } from "vitest";
import { buildEventIndex, serialize, collectPitchEvents, reflectionForm, SetPitchesCommand, REFLECTION_CYCLE, type PitchEvent } from "../src/index.js";
import { scoreFrom, mei } from "./helpers.js";

// the user's own example: first note, +1, +2, +3, −2 (diatonic steps)
const BODY = `
  <measure n="1" xml:id="m1">
    <staff n="1"><layer n="1">
      <note pname="c" oct="4" dur="8" xml:id="r1"/><note pname="d" oct="4" dur="8" xml:id="r2"/>
      <note pname="e" oct="4" dur="8" xml:id="r3"/><note pname="f" oct="4" dur="8" xml:id="r4"/>
      <rest dur="4" xml:id="rr"/><note pname="a" oct="3" dur="4" xml:id="r5"/>
    </layer></staff>
  </measure>`;

const setup = () => {
  const { score } = scoreFrom(mei(BODY));
  const index = buildEventIndex(score);
  const seqs = collectPitchEvents(score, index, 0, 0, 1, 1);
  return { score, index, seqs };
};

const pitchesOf = (targets: PitchEvent[]): string[] => targets.map((t) => t.pitches.map((p) => `${p.pname}${p.oct}`).join("+"));

describe("reflection cycle", () => {
  it("collects one sequence per voice, rests skipped", () => {
    const { seqs } = setup();
    expect(seqs).toHaveLength(1);
    expect(pitchesOf(seqs[0]!)).toEqual(["c4", "d4", "e4", "f4", "a3"]);
  });

  it("inversion mirrors diatonically about the first note", () => {
    const { seqs } = setup();
    // c4 anchor: +1→−1, +2→−2, +3→−3, −2→+2
    expect(pitchesOf(reflectionForm(seqs[0]!, "inversion")!)).toEqual(["c4", "b3", "a3", "g3", "e4"]);
  });

  it("retrograde reverses pitch content over the fixed rhythm", () => {
    const { seqs } = setup();
    expect(pitchesOf(reflectionForm(seqs[0]!, "retrograde")!)).toEqual(["a3", "f4", "e4", "d4", "c4"]);
  });

  it("retrograde inversion reverses the inversion", () => {
    const { seqs } = setup();
    expect(pitchesOf(reflectionForm(seqs[0]!, "retrogradeInversion")!)).toEqual(["e4", "g3", "a3", "b3", "c4"]);
  });

  it("the full cycle applied through commands returns byte-identically", () => {
    const { score, index, seqs } = setup();
    const before = serialize(score.scoreEl);
    const base = seqs[0]!;
    for (const form of REFLECTION_CYCLE) {
      const targets = reflectionForm(base, form)!;
      new SetPitchesCommand(targets, form).apply({ score, index: buildEventIndex(score) });
    }
    expect(serialize(score.scoreEl)).toBe(before);
  });

  it("accidentals travel with their pitch content through retrograde", () => {
    const body = `
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1">
          <note pname="c" oct="4" dur="2" xml:id="a1" accid="s"/><note pname="g" oct="4" dur="2" xml:id="a2"/>
        </layer></staff>
      </measure>`;
    const { score } = scoreFrom(mei(body));
    const index = buildEventIndex(score);
    const seqs = collectPitchEvents(score, index, 0, 0, 1, 1);
    const targets = reflectionForm(seqs[0]!, "retrograde")!;
    new SetPitchesCommand(targets, "retrograde").apply({ score, index });
    const xml = serialize(score.scoreEl);
    // the sharp moved with the c to the second position
    expect(xml).toContain('<note pname="g" oct="4" dur="2" xml:id="a1"/>');
    expect(xml).toContain('<note pname="c" oct="4" dur="2" xml:id="a2" accid="s"/>');
  });

  it("retrograde refuses when chord sizes don't mirror", () => {
    const body = `
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1">
          <chord dur="2" xml:id="c1"><note pname="c" oct="4" xml:id="c1a"/><note pname="e" oct="4" xml:id="c1b"/></chord>
          <note pname="g" oct="4" dur="2" xml:id="n2"/>
        </layer></staff>
      </measure>`;
    const { score } = scoreFrom(mei(body));
    const index = buildEventIndex(score);
    const seqs = collectPitchEvents(score, index, 0, 0, 1, 1);
    expect(reflectionForm(seqs[0]!, "retrograde")).toBeNull();
    expect(reflectionForm(seqs[0]!, "inversion")).not.toBeNull(); // inversion is always fine
  });
});
