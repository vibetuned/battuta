import { describe, it, expect } from "vitest";
import { buildEventIndex, notationFacts } from "../src/index.js";
import { scoreFrom, mei } from "./helpers.js";

// What core REPORTS about ties and marks. What a performance does with
// them (one attack per tie chain, a shorter release for a staccato) is the
// player's — apps/editor/src/performance.ts, and its tests — since slice 7a.
const setup = (body: string) => {
  const { score } = scoreFrom(mei(body));
  const index = buildEventIndex(score);
  return notationFacts(score, index);
};

describe("notationFacts: ties", () => {
  it("chains @tie attributes across the barline (same pitch only)", () => {
    const f = setup(`
      <measure n="1" xml:id="m1"><staff n="1"><layer n="1">
        <note xml:id="a" pname="c" oct="4" dur="2" tie="i"/><note xml:id="b" pname="c" oct="4" dur="2" tie="m"/>
      </layer></staff></measure>
      <measure n="2" xml:id="m2"><staff n="1"><layer n="1">
        <note xml:id="c" pname="c" oct="4" dur="2" tie="t"/><note xml:id="d" pname="e" oct="4" dur="2" tie="i"/>
      </layer></staff></measure>
      <measure n="3" xml:id="m3"><staff n="1"><layer n="1">
        <note xml:id="e" pname="g" oct="4" dur="1" tie="t"/>
      </layer></staff></measure>`);
    expect(f.ties["a"]).toBe("b");
    expect(f.ties["b"]).toBe("c");
    expect(f.ties["d"]).toBeUndefined(); // e is another pitch: not a continuation
  });

  it("reads <tie> control events too", () => {
    const f = setup(`
      <measure n="1" xml:id="m1"><staff n="1"><layer n="1">
        <note xml:id="a" pname="c" oct="4" dur="2"/><note xml:id="b" pname="c" oct="4" dur="2"/>
      </layer></staff><tie xml:id="t1" startid="#a" endid="#b"/></measure>`);
    expect(f.ties["a"]).toBe("b");
  });
});

describe("notationFacts: marks", () => {
  it("reports staccato / staccatissimo / tenuto from @artic and slur from a span — both when both apply", () => {
    const f = setup(`
      <measure n="1" xml:id="m1"><staff n="1"><layer n="1">
        <note xml:id="a" pname="c" oct="4" dur="4"/><note xml:id="b" pname="d" oct="4" dur="4" artic="stacc"/>
        <note xml:id="c" pname="e" oct="4" dur="4" artic="stacciss"/><note xml:id="d" pname="f" oct="4" dur="4" artic="ten"/>
      </layer></staff><slur xml:id="sl" startid="#a" endid="#b"/></measure>`);
    expect(f.marks["a"]).toEqual(["slur"]);
    expect(f.marks["b"]).toEqual(["staccato", "slur"]); // a fact, not a verdict: the performer decides which wins
    expect(f.marks["c"]).toEqual(["staccatissimo"]);
    expect(f.marks["d"]).toEqual(["tenuto"]);
  });

  it("a chord-level @artic covers members without one; a member's own wins outright", () => {
    const f = setup(`
      <measure n="1" xml:id="m1"><staff n="1"><layer n="1">
        <chord xml:id="ch" dur="4" artic="stacc">
          <note xml:id="x" pname="c" oct="4"/><note xml:id="y" pname="e" oct="4" artic="ten"/>
        </chord><rest dur="4"/><rest dur="2"/>
      </layer></staff></measure>`);
    expect(f.marks["x"]).toEqual(["staccato"]);
    expect(f.marks["y"]).toEqual(["tenuto"]);
  });

  it("an unmarked note has no entry at all", () => {
    const f = setup(`
      <measure n="1" xml:id="m1"><staff n="1"><layer n="1">
        <note xml:id="a" pname="c" oct="4" dur="1"/>
      </layer></staff></measure>`);
    expect(f.marks).toEqual({});
    expect(f.ties).toEqual({});
  });
});
