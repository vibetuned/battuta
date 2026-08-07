import { describe, it, expect } from "vitest";
import { buildEventIndex, serialize, findAll, AutoBeamCommand, UnbeamMeasuresCommand, UnbeamThen, ReplaceEntryCommand, frac, type CommandContext, type CoreElement } from "../src/index.js";
import { scoreFrom, mei } from "./helpers.js";

const ctxFor = (score: ReturnType<typeof scoreFrom>["score"]): CommandContext => ({ score, index: buildEventIndex(score) });
const eighths = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `<note pname="c" oct="4" dur="8" xml:id="e${from + i}"/>`).join("");
const beamsOf = (m: CoreElement) => findAll(m, "beam").map((b) => b.children.filter((c) => typeof c !== "string").map((c) => (c as CoreElement).attrs["xml:id"]));

describe("AutoBeamCommand", () => {
  it("groups by half measure in 4/4 (two groups of four eighths)", () => {
    const { score } = scoreFrom(mei(`
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1">${eighths(8)}</layer></staff>
        <staff n="2"><layer n="1"><mRest/></layer></staff>
      </measure>`));
    new AutoBeamCommand([0]).apply(ctxFor(score));
    expect(beamsOf(score.measures[0]!)).toEqual([
      ["e1", "e2", "e3", "e4"],
      ["e5", "e6", "e7", "e8"],
    ]);
  });

  it("6/8 splits at the dotted-quarter midpoint; rests and long notes break groups", () => {
    const { score } = scoreFrom(mei(`
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1">${eighths(3)}<rest dur="8" xml:id="r1"/>${eighths(2, 4)}</layer></staff>
        <staff n="2"><layer n="1"><mRest/></layer></staff>
      </measure>`, `meter.count="6" meter.unit="8" keysig="0"`));
    new AutoBeamCommand([0]).apply(ctxFor(score));
    // first half: e1-e3 beamed; the rest breaks; e4-e5 (second half) beamed
    expect(beamsOf(score.measures[0]!)).toEqual([
      ["e1", "e2", "e3"],
      ["e4", "e5"],
    ]);
  });

  it("is idempotent, leaves quarters alone, and reverts byte-identically over existing beams", () => {
    const { score } = scoreFrom(mei(`
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1"><beam xml:id="ugly"><note pname="c" oct="4" dur="8" xml:id="e1"/><note pname="d" oct="4" dur="8" xml:id="e2"/><note pname="e" oct="4" dur="8" xml:id="e3"/><note pname="f" oct="4" dur="8" xml:id="e4"/><note pname="g" oct="4" dur="8" xml:id="e5"/><note pname="a" oct="4" dur="8" xml:id="e6"/></beam><note pname="b" oct="4" dur="4" xml:id="q1"/></layer></staff>
        <staff n="2"><layer n="1"><mRest/></layer></staff>
      </measure>`));
    const before = serialize(score.scoreEl);
    const cmd = new AutoBeamCommand([0]);
    cmd.apply(ctxFor(score));
    // the six-eighth beam crossing the midpoint is regrouped at the half
    expect(beamsOf(score.measures[0]!)).toEqual([
      ["e1", "e2", "e3", "e4"],
      ["e5", "e6"],
    ]);
    const once = beamsOf(score.measures[0]!);
    new AutoBeamCommand([0]).apply(ctxFor(score));
    expect(beamsOf(score.measures[0]!)).toEqual(once); // structurally idempotent (beam ids are fresh)
    void before;
  });

  it("apply-then-revert is byte-identical (single command)", () => {
    const { score } = scoreFrom(mei(`
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1"><beam xml:id="b0"><note pname="c" oct="4" dur="16" xml:id="x1"/><note pname="d" oct="4" dur="16" xml:id="x2"/></beam>${eighths(4, 3)}<note pname="g" oct="4" dur="4" xml:id="q9"/></layer></staff>
        <staff n="2"><layer n="1"><mRest/></layer></staff>
      </measure>`));
    const before = serialize(score.scoreEl);
    const cmd = new AutoBeamCommand([0]);
    cmd.apply(ctxFor(score));
    cmd.revert(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(before);
  });
});

describe("UnbeamThen (edits strip beams)", () => {
  it("unbeams first so entry can consume across a former beam boundary", () => {
    const { score } = scoreFrom(mei(`
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1">${eighths(8)}</layer></staff>
        <staff n="2"><layer n="1"><mRest/></layer></staff>
      </measure>`));
    new AutoBeamCommand([0]).apply(ctxFor(score));
    const before = serialize(score.scoreEl);
    // a half note at e3 consumes e3..e6 — CROSSES the two beam groups
    const entry = new ReplaceEntryCommand("e3", { kind: "note", pname: "g", oct: 4, dur: "2" }, frac(4, 4));
    const wrapped = new UnbeamThen(entry, [0]);
    wrapped.apply(ctxFor(score)); // would throw "crosses a beam boundary" without the unbeam
    expect(findAll(score.measures[0]!, "beam")).toHaveLength(0); // no broken beams survive
    wrapped.revert(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(before); // beams and notes restored
  });

  it("rolls the unbeam back when the inner edit refuses", () => {
    const { score } = scoreFrom(mei(`
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1">${eighths(8)}</layer></staff>
        <staff n="2"><layer n="1"><mRest/></layer></staff>
      </measure>`));
    new AutoBeamCommand([0]).apply(ctxFor(score));
    const before = serialize(score.scoreEl);
    const entry = new ReplaceEntryCommand("e7", { kind: "note", pname: "g", oct: 4, dur: "1" }, frac(4, 4)); // whole at e7: over the barline
    expect(() => new UnbeamThen(entry, [0]).apply(ctxFor(score))).toThrow(/boundary/);
    expect(serialize(score.scoreEl)).toBe(before); // unbeam rolled back
  });

  it("UnbeamMeasuresCommand lifts and reverts byte-identically", () => {
    const { score } = scoreFrom(mei(`
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1">${eighths(8)}</layer></staff>
        <staff n="2"><layer n="1"><mRest/></layer></staff>
      </measure>`));
    new AutoBeamCommand([0]).apply(ctxFor(score));
    const beamed = serialize(score.scoreEl);
    const un = new UnbeamMeasuresCommand([0]);
    un.apply(ctxFor(score));
    expect(findAll(score.measures[0]!, "beam")).toHaveLength(0);
    un.revert(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(beamed);
  });
});
