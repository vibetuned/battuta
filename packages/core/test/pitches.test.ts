/**
 * The document half of the old reflect.test.ts: reading pitch content out
 * of a block and writing it back. The serial-form cases moved with the
 * maths into packages/plugins/reflection/test/forms.test.ts — core has no
 * reflection concept left, so nothing here builds a target with one.
 */
import { describe, it, expect } from "vitest";
import { buildEventIndex, serialize, collectPitchEvents, SetPitchesCommand, type PitchEvent } from "../src/index.js";
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

describe("collectPitchEvents", () => {
  it("collects one sequence per voice, rests skipped", () => {
    const { seqs } = setup();
    expect(seqs).toHaveLength(1);
    expect(pitchesOf(seqs[0]!)).toEqual(["c4", "d4", "e4", "f4", "a3"]);
  });

  it("reads a chord's notes in child order, with their accidentals", () => {
    const body = `
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1">
          <chord dur="2" xml:id="c1"><note pname="c" oct="4" xml:id="c1a" accid="s"/><note pname="e" oct="4" xml:id="c1b"/></chord>
          <note pname="g" oct="4" dur="2" xml:id="n2" accid.ges="f"/>
        </layer></staff>
      </measure>`;
    const { score } = scoreFrom(mei(body));
    const seqs = collectPitchEvents(score, buildEventIndex(score), 0, 0, 1, 1);
    expect(seqs[0]![0]!.pitches).toEqual([
      { pname: "c", oct: 4, accid: "s" },
      { pname: "e", oct: 4 },
    ]);
    expect(seqs[0]![1]!.pitches).toEqual([{ pname: "g", oct: 4, accidGes: "f" }]);
  });

  it("spans the requested measures and staves only", () => {
    const body = `
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1"><note pname="c" oct="4" dur="1" xml:id="s1"/></layer></staff>
        <staff n="2"><layer n="1"><note pname="e" oct="3" dur="1" xml:id="s2"/></layer></staff>
      </measure>`;
    const { score } = scoreFrom(mei(body));
    const index = buildEventIndex(score);
    expect(collectPitchEvents(score, index, 0, 0, 1, 1)).toHaveLength(1);
    expect(collectPitchEvents(score, index, 0, 0, 1, 2)).toHaveLength(2);
    expect(collectPitchEvents(score, index, 0, 0, 3, 9)).toEqual([]);
  });
});

describe("SetPitchesCommand", () => {
  it("writes pitch triples onto the events and reverts byte-identically", () => {
    const { score, index, seqs } = setup();
    const before = serialize(score.scoreEl);
    const base = seqs[0]!;
    // a plain diatonic shift, built from the document it writes to
    const targets: PitchEvent[] = base.map((ev) => ({ eventId: ev.eventId, pitches: ev.pitches.map((p) => ({ ...p, pname: p.pname === "b" ? "c" : p.pname })) }));
    const cmd = new SetPitchesCommand(targets, "test");
    cmd.apply({ score, index });
    cmd.revert({ score, index });
    expect(serialize(score.scoreEl)).toBe(before);
  });

  it("moves accidentals with their pitch content", () => {
    const body = `
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1">
          <note pname="c" oct="4" dur="2" xml:id="a1" accid="s"/><note pname="g" oct="4" dur="2" xml:id="a2"/>
        </layer></staff>
      </measure>`;
    const { score } = scoreFrom(mei(body));
    const index = buildEventIndex(score);
    const seqs = collectPitchEvents(score, index, 0, 0, 1, 1);
    // swap the two events' content: the sharp travels to the second note
    const [first, second] = seqs[0]!;
    new SetPitchesCommand(
      [
        { eventId: first!.eventId, pitches: second!.pitches },
        { eventId: second!.eventId, pitches: first!.pitches },
      ],
      "swap",
    ).apply({ score, index });
    const xml = serialize(score.scoreEl);
    expect(xml).toContain('<note pname="g" oct="4" dur="2" xml:id="a1"/>');
    expect(xml).toContain('<note pname="c" oct="4" dur="2" xml:id="a2" accid="s"/>');
  });

  it("refuses a target whose pitch count does not match the event", () => {
    const { score, index, seqs } = setup();
    const ev = seqs[0]![0]!;
    const cmd = new SetPitchesCommand([{ eventId: ev.eventId, pitches: [...ev.pitches, { pname: "g", oct: 4 }] }], "bad");
    expect(() => cmd.apply({ score, index })).toThrow(/pitch count/);
  });

  it("reports one dirty region per (measure, staff) it touched", () => {
    const body = `
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1"><note pname="c" oct="4" dur="1" xml:id="d1"/></layer></staff>
        <staff n="2"><layer n="1"><note pname="e" oct="3" dur="1" xml:id="d2"/></layer></staff>
      </measure>`;
    const { score } = scoreFrom(mei(body));
    const index = buildEventIndex(score);
    const regions = new SetPitchesCommand(
      [
        { eventId: "d1", pitches: [{ pname: "d", oct: 4 }] },
        { eventId: "d2", pitches: [{ pname: "f", oct: 3 }] },
      ],
      "two staves",
    ).apply({ score, index });
    expect(regions).toEqual([
      { measureIndex: 0, staffN: 1 },
      { measureIndex: 0, staffN: 2 },
    ]);
  });

  it("defaults its label to a description of the write, not of a caller's intent", () => {
    expect(new SetPitchesCommand([]).label).toBe("set pitches");
  });
});
