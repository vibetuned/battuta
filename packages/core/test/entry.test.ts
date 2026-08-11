import { describe, it, expect } from "vitest";
import {
  buildEventIndex, serialize, frac, fEq, decomposeDuration, validateMeasureDurations, findAll,
  ReplaceEntryCommand, AddChordNoteCommand, ToggleTieCommand, ChainTieCommand, ToggleSlurCommand, ToggleArticCommand, ToggleDynamCommand,
  MergeEventsCommand, SplitEventCommand, CycleDynamCommand, CycleHairpinCommand, ChangeDurationCommand, ToggleFingCommand, ToggleMarkCommand, OrnamentCycleCommand, ToggleGraceCommand, TogglePedalCommand, BeatRepeatCommand, MeasureRepeatCycleCommand, TupletCommand,
  type CommandContext,
} from "../src/index.js";
import { scoreFrom, mei } from "./helpers.js";

const ctxFor = (score: ReturnType<typeof scoreFrom>["score"]): CommandContext => ({ score, index: buildEventIndex(score) });
const CAP = frac(4, 4);

const BODY = `
  <measure n="1" xml:id="m1">
    <staff n="1"><layer n="1"><note pname="c" oct="4" dur="4" xml:id="q1"/><note pname="d" oct="4" dur="4" xml:id="q2"/><note pname="e" oct="4" dur="2" xml:id="h1"/></layer></staff>
    <staff n="2"><layer n="1"><mRest xml:id="mr1"/></layer></staff>
  </measure>
  <measure n="2" xml:id="m2">
    <staff n="1"><layer n="1"><note pname="c" oct="4" dur="1" xml:id="w1"/></layer></staff>
    <staff n="2"><layer n="1"><beam><note pname="c" oct="3" dur="8" xml:id="b1"/><note pname="d" oct="3" dur="8" xml:id="b2"/></beam><note pname="e" oct="3" dur="2" xml:id="h2"/><rest dur="4" xml:id="r1"/></layer></staff>
  </measure>`;

const validAll = (score: ReturnType<typeof scoreFrom>["score"]) => {
  for (const m of score.measures) expect(validateMeasureDurations(m, { count: "4", unit: "4" })).toHaveLength(0);
};

describe("decomposeDuration", () => {
  it("decomposes into plain and single-dotted values, largest first", () => {
    expect(decomposeDuration(frac(1, 4))).toEqual([{ dur: "4" }]);
    expect(decomposeDuration(frac(3, 8))).toEqual([{ dur: "4", dots: 1 }]);
    expect(decomposeDuration(frac(5, 8))).toEqual([{ dur: "2" }, { dur: "8" }]);
    expect(decomposeDuration(frac(7, 8))).toEqual([{ dur: "2", dots: 1 }, { dur: "8" }]);
    expect(decomposeDuration(frac(0, 1))).toEqual([]);
  });
});

describe("ReplaceEntryCommand", () => {
  it("equal duration: swaps in place", () => {
    const { score } = scoreFrom(mei(BODY));
    const cmd = new ReplaceEntryCommand("q1", { kind: "note", pname: "g", oct: 4, dur: "4" }, CAP);
    cmd.apply(ctxFor(score));
    const layer = findAll(score.measures[0]!, "note");
    expect(layer[0]!.attrs["pname"]).toBe("g");
    expect(layer).toHaveLength(3);
    validAll(score);
  });

  it("shorter: fills the remainder with rests", () => {
    const { score } = scoreFrom(mei(BODY));
    new ReplaceEntryCommand("w1", { kind: "note", pname: "a", oct: 4, dur: "4" }, CAP).apply(ctxFor(score));
    const m2s1 = score.measures[1]!;
    expect(findAll(m2s1, "note").some((n) => n.attrs["pname"] === "a" && n.attrs["dur"] === "4")).toBe(true);
    expect(findAll(m2s1, "rest").map((r) => `${r.attrs["dur"]}${r.attrs["dots"] ?? ""}`)).toContain("21");
    validAll(score);
  });

  it("longer: consumes following events, filling any partial remainder", () => {
    const { score } = scoreFrom(mei(BODY));
    new ReplaceEntryCommand("q1", { kind: "note", pname: "g", oct: 4, dur: "2" }, CAP).apply(ctxFor(score));
    const notes = findAll(score.measures[0]!, "note");
    expect(notes.map((n) => n.attrs["pname"])).toEqual(["g", "e"]); // d consumed
    validAll(score);

    const { score: s2 } = scoreFrom(mei(BODY));
    new ReplaceEntryCommand("q2", { kind: "note", pname: "g", oct: 4, dur: "2", dots: 1 }, CAP).apply(ctxFor(s2)); // q2(1/4)+h1(1/2)=3/4 exactly
    expect(findAll(s2.measures[0]!, "note").map((n) => n.attrs["pname"])).toEqual(["c", "g"]);
    validAll(s2);
  });

  it("refuses to cross a beam boundary", () => {
    const { score } = scoreFrom(mei(BODY));
    // h2 (1/2) followed by rest (1/4) = 3/4 available at top level; a whole
    // note would need to consume past the layer end.
    expect(() => new ReplaceEntryCommand("h2", { kind: "note", pname: "c", oct: 3, dur: "1" }, CAP).apply(ctxFor(score))).toThrow(/boundary/);
    // b1 is inside a beam; entering a half note there must not eat h2.
    expect(() => new ReplaceEntryCommand("b1", { kind: "note", pname: "c", oct: 3, dur: "2" }, CAP).apply(ctxFor(score))).toThrow(/boundary/);
  });

  it("replaces an mRest against the measure capacity", () => {
    const { score } = scoreFrom(mei(BODY));
    const cmd = new ReplaceEntryCommand("mr1", { kind: "note", pname: "f", oct: 3, dur: "4" }, CAP);
    cmd.apply(ctxFor(score));
    const staff2 = findAll(score.measures[0]!, "staff").find((s) => s.attrs["n"] === "2")!;
    expect(findAll(staff2, "note")).toHaveLength(1);
    expect(findAll(staff2, "rest").map((r) => `${r.attrs["dur"]}${r.attrs["dots"] ?? ""}`)).toEqual(["21"]);
    validAll(score);
    expect(cmd.enteredId).toBeTruthy();
  });

  it("carry attributes survive re-entry (postfix dot keeps artic/tie)", () => {
    const { score } = scoreFrom(mei(BODY));
    new ToggleArticCommand(["q1"], "stacc").apply(ctxFor(score));
    const cmd = new ReplaceEntryCommand("q1", { kind: "note", pname: "c", oct: 4, dur: "8", carry: { artic: "stacc" } }, CAP);
    cmd.apply(ctxFor(score));
    const entered = findAll(score.measures[0]!, "note").find((n) => n.attrs["xml:id"] === cmd.enteredId)!;
    expect(entered.attrs["artic"]).toBe("stacc");
    expect(entered.attrs["dur"]).toBe("8");
    validAll(score);
  });

  it("apply-then-revert restores the document byte-identically", () => {
    const { score } = scoreFrom(mei(BODY));
    const before = score.measures.map((m) => serialize(m)).join();
    const cmd = new ReplaceEntryCommand("w1", { kind: "rest", dur: "8" }, CAP);
    cmd.apply(ctxFor(score));
    cmd.revert(ctxFor(score));
    expect(score.measures.map((m) => serialize(m)).join()).toBe(before);
  });
});

describe("AddChordNoteCommand", () => {
  it("promotes a note to a chord (duration moves to the chord)", () => {
    const { score } = scoreFrom(mei(BODY));
    new AddChordNoteCommand("q1", "e", 4).apply(ctxFor(score));
    const chord = findAll(score.measures[0]!, "chord")[0]!;
    expect(chord.attrs["dur"]).toBe("4");
    const notes = findAll(chord, "note");
    expect(notes).toHaveLength(2);
    expect(notes.every((n) => n.attrs["dur"] === undefined)).toBe(true);
    validAll(score);
  });

  it("grows an existing chord and rejects duplicate pitches", () => {
    const { score } = scoreFrom(mei(BODY));
    new AddChordNoteCommand("q1", "e", 4).apply(ctxFor(score));
    const chordId = findAll(score.measures[0]!, "chord")[0]!.attrs["xml:id"]!;
    new AddChordNoteCommand(chordId, "g", 4).apply(ctxFor(score));
    expect(findAll(score.measures[0]!, "chord")[0]!.children).toHaveLength(3);
    expect(() => new AddChordNoteCommand(chordId, "g", 4).apply(ctxFor(score))).toThrow(/already/);
  });
});

describe("ToggleTieCommand", () => {
  it("ties equal pitches (also across the barline) and toggles off", () => {
    const body = `
      <measure n="1" xml:id="m1"><staff n="1"><layer n="1"><note pname="g" oct="4" dur="2" xml:id="a"/><note pname="g" oct="4" dur="2" xml:id="b"/></layer></staff><staff n="2"><layer n="1"><mRest/></layer></staff></measure>
      <measure n="2" xml:id="m2"><staff n="1"><layer n="1"><note pname="g" oct="4" dur="1" xml:id="c"/></layer></staff><staff n="2"><layer n="1"><mRest/></layer></staff></measure>`;
    const { score } = scoreFrom(mei(body));
    const find = (id: string) => findAll(score.measures[0]!, "note").concat(findAll(score.measures[1]!, "note")).find((n) => n.attrs["xml:id"] === id)!;
    new ToggleTieCommand("a").apply(ctxFor(score));
    expect(find("a").attrs["tie"]).toBe("i");
    expect(find("b").attrs["tie"]).toBe("t");
    new ToggleTieCommand("a").apply(ctxFor(score));
    expect(find("a").attrs["tie"]).toBeUndefined();
    new ToggleTieCommand("b").apply(ctxFor(score)); // b -> c crosses the barline
    expect(find("b").attrs["tie"]).toBe("i");
    expect(find("c").attrs["tie"]).toBe("t");
  });

  it("refuses ties between different pitches", () => {
    const { score } = scoreFrom(mei(BODY));
    expect(() => new ToggleTieCommand("q1").apply(ctxFor(score))).toThrow(/same pitch/);
  });
});

describe("MergeEventsCommand / SplitEventCommand", () => {
  const MERGE_BODY = `
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="4" xml:id="c1"/><note pname="c" oct="4" dur="4" xml:id="c2"/><note pname="c" oct="4" dur="8" xml:id="c3"/><note pname="d" oct="4" dur="8" xml:id="d1"/><rest dur="8" xml:id="r1"/><rest dur="8" xml:id="r2"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="e" oct="3" dur="2" xml:id="h1" tie="t"/><note pname="e" oct="3" dur="4" xml:id="h2"/><rest dur="4" xml:id="r3"/></layer></staff>
    </measure>`;

  it("merges same-pitch pairs into single written durations", () => {
    const { score } = scoreFrom(mei(MERGE_BODY));
    new MergeEventsCommand("c1").apply(ctxFor(score)); // 1/4+1/4 -> 1/2
    const c1 = findAll(score.measures[0]!, "note").find((n) => n.attrs["xml:id"] === "c1")!;
    expect(c1.attrs["dur"]).toBe("2");
    expect(findAll(score.measures[0]!, "note").some((n) => n.attrs["xml:id"] === "c2")).toBe(false);
    validAll(score);
    // now c1(1/2) + c3(1/8) = 5/8: not a single written value
    expect(() => new MergeEventsCommand("c1").apply(ctxFor(score))).toThrow(/single written/);
  });

  it("merges into dotted values and merges rests", () => {
    const { score } = scoreFrom(mei(MERGE_BODY));
    new MergeEventsCommand("c2").apply(ctxFor(score)); // 1/4+1/8 -> dotted quarter
    const c2 = findAll(score.measures[0]!, "note").find((n) => n.attrs["xml:id"] === "c2")!;
    expect(c2.attrs["dur"]).toBe("4");
    expect(c2.attrs["dots"]).toBe("1");
    new MergeEventsCommand("r1").apply(ctxFor(score));
    const r1 = findAll(score.measures[0]!, "rest").find((r) => r.attrs["xml:id"] === "r1")!;
    expect(r1.attrs["dur"]).toBe("4");
    validAll(score);
  });

  it("refuses different pitches and mixed note/rest pairs", () => {
    const { score } = scoreFrom(mei(MERGE_BODY));
    expect(() => new MergeEventsCommand("c3").apply(ctxFor(score))).toThrow(/same pitch/);
    expect(() => new MergeEventsCommand("d1").apply(ctxFor(score))).toThrow(/two notes, two rests/);
    expect(() => new MergeEventsCommand("h2").apply(ctxFor(score))).toThrow(/two notes, two rests/);
  });

  it("preserves outer tie ends when merging", () => {
    const { score } = scoreFrom(mei(MERGE_BODY));
    new MergeEventsCommand("h1").apply(ctxFor(score)); // h1 tie="t" + h2 -> keeps "t"
    const h1 = findAll(score.measures[0]!, "note").find((n) => n.attrs["xml:id"] === "h1")!;
    expect(h1.attrs["dur"]).toBe("2");
    expect(h1.attrs["dots"]).toBe("1");
    expect(h1.attrs["tie"]).toBe("t");
  });

  it("split halves in place, keeps identity, redistributes ties", () => {
    const { score } = scoreFrom(mei(MERGE_BODY));
    new SplitEventCommand("h1").apply(ctxFor(score)); // dotted? no: plain 1/2 tie=t
    const notes = findAll(score.measures[0]!, "note").filter((n) => n.attrs["pname"] === "e");
    expect(notes[0]!.attrs["xml:id"]).toBe("h1");
    expect(notes[0]!.attrs["dur"]).toBe("4");
    expect(notes[0]!.attrs["tie"]).toBe("t"); // incoming tie stays on first half
    expect(notes[1]!.attrs["dur"]).toBe("4");
    expect(notes[1]!.attrs["xml:id"]).not.toBe("h1");
    expect(notes[1]!.attrs["tie"]).toBeUndefined();
    validAll(score);
  });

  it("split keeps dots (dotted half -> two dotted quarters) and splits chords", () => {
    const body = `<measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="g" oct="4" dur="2" dots="1" xml:id="dh"/><chord dur="4" xml:id="ch"><note pname="c" oct="4" xml:id="cn1"/><note pname="e" oct="4" xml:id="cn2"/></chord></layer></staff>
      <staff n="2"><layer n="1"><mRest xml:id="mr"/></layer></staff>
    </measure>`;
    const { score } = scoreFrom(mei(body));
    new SplitEventCommand("dh").apply(ctxFor(score));
    const gs = findAll(score.measures[0]!, "note").filter((n) => n.attrs["pname"] === "g");
    expect(gs.map((n) => `${n.attrs["dur"]}.${n.attrs["dots"]}`)).toEqual(["4.1", "4.1"]);
    new SplitEventCommand("ch").apply(ctxFor(score));
    const chords = findAll(score.measures[0]!, "chord");
    expect(chords).toHaveLength(2);
    expect(chords.map((c) => c.attrs["dur"])).toEqual(["8", "8"]);
    // cloned chord notes get fresh ids
    const ids = chords.flatMap((c) => findAll(c, "note").map((n) => n.attrs["xml:id"]));
    expect(new Set(ids).size).toBe(4);
    validAll(score);
    expect(() => new SplitEventCommand("mr").apply(ctxFor(score))).toThrow(/whole-measure/);
  });

  it("splits an mRest into half-capacity rests and merges them back (new measures)", () => {
    const body = `<measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><mRest xml:id="mr"/></layer></staff>
      <staff n="2"><layer n="1"><mRest xml:id="mr2"/></layer></staff>
    </measure>`;
    const { score } = scoreFrom(mei(body));
    // 4/4: mRest -> two half rests; the first keeps the mRest's id
    new SplitEventCommand("mr", frac(4, 4)).apply(ctxFor(score));
    const staff1 = findAll(score.measures[0]!, "staff")[0]!;
    expect(findAll(staff1, "rest").map((r) => `${r.attrs["dur"]}`)).toEqual(["2", "2"]);
    expect(findAll(staff1, "rest")[0]!.attrs["xml:id"]).toBe("mr");
    validAll(score);
    // merging the two half rests back collapses into an mRest again
    new MergeEventsCommand("mr", frac(4, 4)).apply(ctxFor(score));
    expect(findAll(staff1, "rest")).toHaveLength(0);
    expect(findAll(staff1, "mRest")).toHaveLength(1);
    expect(findAll(staff1, "mRest")[0]!.attrs["xml:id"]).toBe("mr");
    validAll(score);
    // without capacity, mRest split still refuses
    expect(() => new SplitEventCommand("mr2").apply(ctxFor(score))).toThrow(/capacity/);
  });

  it("mRest split handles compound meters (6/8 -> two dotted-quarter rests)", () => {
    const body = `<measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><mRest xml:id="mr"/></layer></staff>
      <staff n="2"><layer n="1"><mRest/></layer></staff>
    </measure>`;
    const { score } = scoreFrom(mei(body, `meter.count="6" meter.unit="8" keysig="0"`));
    new SplitEventCommand("mr", frac(6, 8)).apply(ctxFor(score));
    const staff1 = findAll(score.measures[0]!, "staff")[0]!;
    expect(findAll(staff1, "rest").map((r) => `${r.attrs["dur"]}${r.attrs["dots"] ?? ""}`)).toEqual(["41", "41"]);
    for (const m of score.measures) expect(validateMeasureDurations(m, { count: "6", unit: "8" })).toHaveLength(0);
  });

  it("merge undoes split byte-identically and vice versa", () => {
    const { score } = scoreFrom(mei(MERGE_BODY));
    const before = score.measures.map((m) => serialize(m)).join();
    const split = new SplitEventCommand("c1");
    split.apply(ctxFor(score));
    split.revert(ctxFor(score));
    expect(score.measures.map((m) => serialize(m)).join()).toBe(before);
    const merge = new MergeEventsCommand("c1");
    merge.apply(ctxFor(score));
    merge.revert(ctxFor(score));
    expect(score.measures.map((m) => serialize(m)).join()).toBe(before);
  });
});

describe("ChangeDurationCommand", () => {
  it("dots a CHORD in place: children and ids preserved, time consumed", () => {
    const body = `<measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><chord dur="4" xml:id="ch"><note pname="c" oct="4" xml:id="cn1"/><note pname="e" oct="4" xml:id="cn2"/></chord><rest dur="4" xml:id="r1"/><rest dur="2" xml:id="r2"/></layer></staff>
      <staff n="2"><layer n="1"><mRest/></layer></staff>
    </measure>`;
    const { score } = scoreFrom(mei(body));
    const cmd = new ChangeDurationCommand("ch", "4", 1, frac(4, 4));
    cmd.apply(ctxFor(score));
    const chord = findAll(score.measures[0]!, "chord")[0]!;
    expect(chord.attrs["xml:id"]).toBe("ch"); // same identity
    expect(chord.attrs["dur"]).toBe("4");
    expect(chord.attrs["dots"]).toBe("1");
    expect(findAll(chord, "note").map((n) => n.attrs["xml:id"])).toEqual(["cn1", "cn2"]);
    // dotted quarter consumed an eighth from r1 (1/4): remainder 1/8
    expect(findAll(score.measures[0]!, "rest").map((r) => r.attrs["dur"])).toEqual(["8", "2"]);
    validAll(score);
    cmd.revert(ctxFor(score));
    expect(findAll(score.measures[0]!, "rest").map((r) => r.attrs["dur"])).toEqual(["4", "2"]);
    validAll(score);
  });

  it("un-dotting releases time as rests; boundaries refuse", () => {
    const body = `<measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="2" dots="1" xml:id="dh"/><note pname="d" oct="4" dur="4" xml:id="q"/></layer></staff>
      <staff n="2"><layer n="1"><mRest/></layer></staff>
    </measure>`;
    const { score } = scoreFrom(mei(body));
    new ChangeDurationCommand("dh", "2", 0, frac(4, 4)).apply(ctxFor(score));
    expect(findAll(score.measures[0]!, "rest").map((r) => r.attrs["dur"])).toEqual(["4"]);
    validAll(score);
    // q is the last event: dotting it would cross the measure end
    expect(() => new ChangeDurationCommand("q", "4", 1, frac(4, 4)).apply(ctxFor(score))).toThrow(/boundary/);
  });
});

describe("artic + dynam", () => {
  it("toggles articulation values in the @artic list", () => {
    const { score } = scoreFrom(mei(BODY));
    const noteOf = () => findAll(score.measures[0]!, "note")[0]!;
    new ToggleArticCommand(["q1"], "stacc").apply(ctxFor(score));
    expect(noteOf().attrs["artic"]).toBe("stacc");
    new ToggleArticCommand(["q1"], "acc").apply(ctxFor(score));
    expect(noteOf().attrs["artic"]).toBe("stacc acc");
    new ToggleArticCommand(["q1"], "stacc").apply(ctxFor(score));
    expect(noteOf().attrs["artic"]).toBe("acc");
  });

  it("cycles a dynam none -> p -> mp -> mf -> f -> none with clean reverts", () => {
    const { score } = scoreFrom(mei(BODY));
    const dynams = () => findAll(score.measures[0]!, "dynam").map((d) => d.children[0]);
    const cmds: CycleDynamCommand[] = [];
    const step = () => {
      const c = new CycleDynamCommand("q1");
      c.apply(ctxFor(score));
      cmds.push(c);
    };
    for (const want of [["p"], ["mp"], ["mf"], ["f"], []] as const) {
      step();
      expect(dynams()).toEqual(want);
    }
    for (const want of [["f"], ["mf"], ["mp"], ["p"], []] as const) {
      cmds.pop()!.revert(ctxFor(score));
      expect(dynams()).toEqual(want);
    }
  });

  it("adds and removes a dynam anchored to the note", () => {
    const { score } = scoreFrom(mei(BODY));
    new ToggleDynamCommand("q1", "f").apply(ctxFor(score));
    const dynam = findAll(score.measures[0]!, "dynam")[0]!;
    expect(dynam.attrs["startid"]).toBe("#q1");
    expect(dynam.children[0]).toBe("f");
    new ToggleDynamCommand("q1", "f").apply(ctxFor(score));
    expect(findAll(score.measures[0]!, "dynam")).toHaveLength(0);
  });
});

describe("ToggleSlurCommand", () => {
  const body = `
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="2" xml:id="a1"/><note pname="d" oct="4" dur="2" xml:id="a2"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="b1"/></layer></staff>
    </measure>
    <measure n="2" xml:id="m2">
      <staff n="1"><layer n="1"><rest dur="2" xml:id="r1"/><note pname="e" oct="4" dur="2" xml:id="a3"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="d" oct="3" dur="1" xml:id="b2"/></layer></staff>
    </measure>
    <measure n="3" xml:id="m3">
      <staff n="1"><layer n="1"><note pname="f" oct="4" dur="1" xml:id="a4"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="e" oct="3" dur="1" xml:id="b3"/></layer></staff>
    </measure>`;

  it("adds a cross-measure slur in the START measure, toggles off byte-identically", () => {
    const { score } = scoreFrom(mei(body));
    const before = serialize(score.scoreEl);
    const cmd = new ToggleSlurCommand("a1", "a4");
    const dirty = cmd.apply(ctxFor(score));
    const slurs = findAll(score.measures[0]!, "slur");
    expect(slurs).toHaveLength(1);
    expect(slurs[0]!.attrs["startid"]).toBe("#a1");
    expect(slurs[0]!.attrs["endid"]).toBe("#a4");
    expect(slurs[0]!.attrs["staff"]).toBe("1");
    expect(findAll(score.measures[2]!, "slur")).toHaveLength(0); // element lives with its start
    expect(dirty.map((d) => d.measureIndex)).toEqual([0, 1, 2]); // every measure the curve passes over
    // same pair again -> removes (via a fresh command, like the UI would)
    new ToggleSlurCommand("a1", "a4").apply(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(before);
  });

  it("normalizes reversed endpoints and revert restores removals in place", () => {
    const { score } = scoreFrom(mei(body));
    new ToggleSlurCommand("a4", "a1").apply(ctxFor(score)); // reversed
    expect(findAll(score.measures[0]!, "slur")[0]!.attrs["startid"]).toBe("#a1");
    const snap = serialize(score.scoreEl);
    const off = new ToggleSlurCommand("a1", "a4");
    off.apply(ctxFor(score)); // removes
    off.revert(ctxFor(score)); // puts it back at the same index
    expect(serialize(score.scoreEl)).toBe(snap);
  });

  it("refuses rests and self-slurs", () => {
    const { score } = scoreFrom(mei(body));
    expect(() => new ToggleSlurCommand("a2", "r1").apply(ctxFor(score))).toThrow(/notes or chords/);
    expect(() => new ToggleSlurCommand("a1", "a1").apply(ctxFor(score))).toThrow(/two different/);
  });

  it("cross-staff slurs are legal: @staff lists both, byte-identical unwind", () => {
    const { score } = scoreFrom(mei(body));
    const before = serialize(score.scoreEl);
    const cmd = new ToggleSlurCommand("a1", "b2");
    cmd.apply(ctxFor(score));
    const slur = findAll(score.measures[0]!, "slur").find((s) => s.attrs["startid"] === "#a1");
    expect(slur?.attrs["staff"]).toBe("1 2");
    cmd.revert(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(before);
  });
});

describe("ChainTieCommand", () => {
  const held = `
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="d" oct="4" dur="2" xml:id="h0"/><note pname="c" oct="4" dur="2" xml:id="h1"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="k1"/></layer></staff>
    </measure>
    <measure n="2" xml:id="m2">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="1" xml:id="h2"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="k2"/></layer></staff>
    </measure>
    <measure n="3" xml:id="m3">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="2" xml:id="h3"/><note pname="e" oct="4" dur="2" xml:id="h4"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="k3"/></layer></staff>
    </measure>`;

  it("ties a run across measures with i/m/t and unties byte-identically", () => {
    const { score } = scoreFrom(mei(held));
    const before = serialize(score.scoreEl);
    new ChainTieCommand(["h1", "h2", "h3"]).apply(ctxFor(score));
    const attr = (id: string) => findAll(score.scoreEl, "note").find((n) => n.attrs["xml:id"] === id)!.attrs["tie"];
    expect([attr("h1"), attr("h2"), attr("h3")]).toEqual(["i", "m", "t"]);
    // same run again -> untie
    new ChainTieCommand(["h1", "h2", "h3"]).apply(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(before);
  });

  it("merges with ties continuing beyond the run's edges", () => {
    const { score } = scoreFrom(mei(held));
    new ChainTieCommand(["h1", "h2"]).apply(ctxFor(score)); // h1=i h2=t
    new ChainTieCommand(["h2", "h3"]).apply(ctxFor(score)); // h2 continues both ways
    const attr = (id: string) => findAll(score.scoreEl, "note").find((n) => n.attrs["xml:id"] === id)!.attrs["tie"];
    expect([attr("h1"), attr("h2"), attr("h3")]).toEqual(["i", "m", "t"]);
    // untying the middle pair preserves the outer halves
    new ChainTieCommand(["h2", "h3"]).apply(ctxFor(score));
    expect([attr("h1"), attr("h2"), attr("h3")]).toEqual(["i", "t", undefined]);
  });

  it("refuses pitch changes, gaps, and non-notes", () => {
    const { score } = scoreFrom(mei(held));
    expect(() => new ChainTieCommand(["h3", "h4"]).apply(ctxFor(score))).toThrow(/same pitch/);
    expect(() => new ChainTieCommand(["h1", "h3"]).apply(ctxFor(score))).toThrow(/consecutive/);
    expect(() => new ChainTieCommand(["h1", "k2"]).apply(ctxFor(score))).toThrow(/one staff/);
    expect(() => new ChainTieCommand(["h1"]).apply(ctxFor(score))).toThrow(/at least two/);
  });

  it("revert restores prior tie attrs exactly", () => {
    const { score } = scoreFrom(mei(held));
    new ChainTieCommand(["h1", "h2"]).apply(ctxFor(score));
    const snap = serialize(score.scoreEl);
    const cmd = new ChainTieCommand(["h2", "h3"]);
    cmd.apply(ctxFor(score));
    cmd.revert(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(snap);
  });
});

describe("ToggleFingCommand", () => {
  const body = `
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="2" xml:id="f1"/><rest dur="2" xml:id="fr"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="f2"/></layer></staff>
    </measure>`;
  const fings = (score: ReturnType<typeof scoreFrom>["score"]) =>
    findAll(score.measures[0]!, "fing").map((f) => f.children.filter((c) => typeof c === "string").join(""));

  it("sets, replaces, and toggles off a fingering", () => {
    const { score } = scoreFrom(mei(body));
    const before = serialize(score.scoreEl);
    new ToggleFingCommand("f1", "3").apply(ctxFor(score));
    expect(fings(score)).toEqual(["3"]);
    const el = findAll(score.measures[0]!, "fing")[0]!;
    expect(el.attrs["startid"]).toBe("#f1");
    expect(el.attrs["place"]).toBe("above");
    new ToggleFingCommand("f1", "2").apply(ctxFor(score)); // replace
    expect(fings(score)).toEqual(["2"]);
    new ToggleFingCommand("f1", "2").apply(ctxFor(score)); // same again -> off
    expect(serialize(score.scoreEl)).toBe(before);
  });

  it("additive adds and removes single fingers; plain set collapses the pile", () => {
    const { score } = scoreFrom(mei(body));
    new ToggleFingCommand("f1", "1").apply(ctxFor(score));
    new ToggleFingCommand("f1", "3", true).apply(ctxFor(score));
    new ToggleFingCommand("f1", "5", true).apply(ctxFor(score));
    expect(fings(score)).toEqual(["1", "3", "5"]);
    new ToggleFingCommand("f1", "3", true).apply(ctxFor(score)); // remove just the 3
    expect(fings(score)).toEqual(["1", "5"]);
    new ToggleFingCommand("f1", "2").apply(ctxFor(score)); // plain set replaces the pile
    expect(fings(score)).toEqual(["2"]);
  });

  it("reverts byte-identically and refuses rests", () => {
    const { score } = scoreFrom(mei(body));
    new ToggleFingCommand("f1", "1").apply(ctxFor(score));
    new ToggleFingCommand("f1", "4", true).apply(ctxFor(score));
    const snap = serialize(score.scoreEl);
    const cmd = new ToggleFingCommand("f1", "2"); // replaces both
    cmd.apply(ctxFor(score));
    cmd.revert(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(snap);
    expect(() => new ToggleFingCommand("fr", "1").apply(ctxFor(score))).toThrow(/notes or chords/);
  });
});

describe("CycleHairpinCommand", () => {
  const body = `
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="2" xml:id="h1"/><note pname="d" oct="4" dur="2" xml:id="h2"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="k1"/></layer></staff>
    </measure>
    <measure n="2" xml:id="m2">
      <staff n="1"><layer n="1"><note pname="e" oct="4" dur="1" xml:id="h3"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="d" oct="3" dur="1" xml:id="k2"/></layer></staff>
    </measure>`;
  const pins = (score: ReturnType<typeof scoreFrom>["score"]) =>
    findAll(score.measures[0]!, "hairpin").map((h) => `${h.attrs["form"]}:${h.attrs["startid"]}→${h.attrs["endid"]}`);

  it("cycles none → cres → dim → none over a cross-measure pair", () => {
    const { score } = scoreFrom(mei(body));
    const before = serialize(score.scoreEl);
    new CycleHairpinCommand("h1", "h3").apply(ctxFor(score));
    expect(pins(score)).toEqual(["cres:#h1→#h3"]);
    expect(findAll(score.measures[0]!, "hairpin")[0]!.attrs["staff"]).toBe("1");
    new CycleHairpinCommand("h1", "h3").apply(ctxFor(score));
    expect(pins(score)).toEqual(["dim:#h1→#h3"]);
    new CycleHairpinCommand("h1", "h3").apply(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(before);
  });

  it("normalizes reversed endpoints, reverts byte-identically, refuses mixed staves", () => {
    const { score } = scoreFrom(mei(body));
    new CycleHairpinCommand("h3", "h1").apply(ctxFor(score)); // reversed
    expect(pins(score)).toEqual(["cres:#h1→#h3"]);
    const snap = serialize(score.scoreEl);
    const cmd = new CycleHairpinCommand("h1", "h3"); // -> dim
    cmd.apply(ctxFor(score));
    cmd.revert(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(snap);
    expect(() => new CycleHairpinCommand("h1", "k2").apply(ctxFor(score))).toThrow(/share a staff/);
    expect(() => new CycleHairpinCommand("h1", "h1").apply(ctxFor(score))).toThrow(/two different/);
  });
});

describe("single markings (fermata, coda, ornament cycle)", () => {
  const body = `
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="2" xml:id="k1"/><chord dur="2" xml:id="kc"><note pname="e" oct="4" xml:id="kc1"/><note pname="g" oct="4" xml:id="kc2"/></chord></layer></staff>
      <staff n="2"><layer n="1"><mRest/></layer></staff>
    </measure>`;

  it("fermata and coda toggle on/off byte-identically", () => {
    const { score } = scoreFrom(mei(body));
    const before = serialize(score.scoreEl);
    new ToggleMarkCommand("k1", "fermata").apply(ctxFor(score));
    expect(findAll(score.measures[0]!, "fermata")).toHaveLength(1);
    new ToggleMarkCommand("k1", "coda").apply(ctxFor(score));
    const rm = findAll(score.measures[0]!, "repeatMark");
    expect(rm).toHaveLength(1);
    expect(rm[0]!.attrs["func"]).toBe("coda");
    new ToggleMarkCommand("k1", "fermata").apply(ctxFor(score));
    for (let i = 0; i < 6; i++) new ToggleMarkCommand("k1", "coda").apply(ctxFor(score)); // walk To Coda…daCapo -> off
    expect(serialize(score.scoreEl)).toBe(before);
  });

  it("the ornament key circles tremolo → trill → mordent → off on a note", () => {
    const { score } = scoreFrom(mei(body));
    const before = serialize(score.scoreEl);
    const state = () => {
      const m = score.measures[0]!;
      if (findAll(m, "trill").length) return "trill";
      if (findAll(m, "mordent").length) return "mordent";
      const idx = buildEventIndex(score);
      return findAll(m, "bTrem").length ? "btrem" : idx.byId.has("k1") ? "none" : "gone";
    };
    new OrnamentCycleCommand("k1").apply(ctxFor(score));
    expect(state()).toBe("btrem");
    expect(buildEventIndex(score).byId.get("k1")?.eventIndex).toBe(0); // still indexed through the wrapper
    new OrnamentCycleCommand("k1").apply(ctxFor(score));
    expect(state()).toBe("trill");
    new OrnamentCycleCommand("k1").apply(ctxFor(score));
    expect(state()).toBe("mordent");
    new OrnamentCycleCommand("k1").apply(ctxFor(score));
    expect(state()).toBe("none");
    expect(serialize(score.scoreEl)).toBe(before); // full circle = untouched
  });

  it("chords start the cycle at the arpeggio; revert restores exactly", () => {
    const { score } = scoreFrom(mei(body));
    new OrnamentCycleCommand("kc").apply(ctxFor(score));
    expect(findAll(score.measures[0]!, "arpeg")).toHaveLength(1);
    const snap = serialize(score.scoreEl);
    const cmd = new OrnamentCycleCommand("kc"); // arpeg -> btrem (remove + wrap)
    cmd.apply(ctxFor(score));
    expect(findAll(score.measures[0]!, "bTrem")).toHaveLength(1);
    cmd.revert(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(snap);
  });
});

describe("grace cycle, pedal, coda/segno cycle", () => {
  const body = `
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="d" oct="4" dur="4" xml:id="g1"/><note pname="c" oct="4" dur="4" xml:id="g2"/><note pname="e" oct="4" dur="2" xml:id="g3"/></layer></staff>
      <staff n="2"><layer n="1"><mRest/></layer></staff>
    </measure>`;

  it("m-pair cycles acciaccatura → appoggiatura → none, folding time into the main note", () => {
    const { score } = scoreFrom(mei(body));
    const before = serialize(score.scoreEl);
    const attrs = (id: string) => findAll(score.scoreEl, "note").find((n) => n.attrs["xml:id"] === id)!.attrs;
    new ToggleGraceCommand("g1", "g2").apply(ctxFor(score));
    expect(attrs("g1")["grace"]).toBe("unacc");
    expect(attrs("g1")["stem.mod"]).toBe("1slash");
    expect(attrs("g2")["dur"]).toBe("2"); // quarter + quarter folded into a half
    // the measure still sums correctly (grace counts zero)
    expect(validateMeasureDurations(score.measures[0]!, { count: "4", unit: "4" }, 1)).toHaveLength(0);
    new ToggleGraceCommand("g1", "g2").apply(ctxFor(score));
    expect(attrs("g1")["grace"]).toBe("acc");
    expect(attrs("g1")["stem.mod"]).toBeUndefined();
    new ToggleGraceCommand("g1", "g2").apply(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(before); // full circle
  });

  it("refuses non-adjacent pairs and unfoldable sums; revert is exact", () => {
    const { score } = scoreFrom(mei(body));
    expect(() => new ToggleGraceCommand("g1", "g3").apply(ctxFor(score))).toThrow(/adjacent/);
    // quarter + half = dotted half — single written duration, allowed
    const cmd = new ToggleGraceCommand("g2", "g3");
    const snap = serialize(score.scoreEl);
    cmd.apply(ctxFor(score));
    expect(findAll(score.scoreEl, "note").find((n) => n.attrs["xml:id"] === "g3")!.attrs["dots"]).toBe("1");
    cmd.revert(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(snap);
  });

  it("pedal toggles a down/up pair over a cross-measure range", () => {
    const two = scoreFrom(mei(`${body.replace('xml:id="m1"', 'xml:id="p1"')}
      <measure n="2" xml:id="p2">
        <staff n="1"><layer n="1"><note pname="f" oct="4" dur="1" xml:id="g9"/></layer></staff>
        <staff n="2"><layer n="1"><mRest/></layer></staff>
      </measure>`));
    const { score } = two;
    const before = serialize(score.scoreEl);
    new TogglePedalCommand("g1", "g9").apply(ctxFor(score));
    const downs = findAll(score.measures[0]!, "pedal");
    const ups = findAll(score.measures[1]!, "pedal");
    expect(downs).toHaveLength(1);
    expect(downs[0]!.attrs["dir"]).toBe("down");
    expect(ups[0]!.attrs["dir"]).toBe("up");
    new TogglePedalCommand("g9", "g1").apply(ctxFor(score)); // reversed order still matches
    expect(serialize(score.scoreEl)).toBe(before);
  });

});

describe("simile and measure repeats", () => {
  const body = `
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="4" xml:id="s1"/><note pname="d" oct="4" dur="8" xml:id="s2"/><note pname="e" oct="4" dur="8" xml:id="s3"/><note pname="f" oct="4" dur="2" xml:id="s4"/></layer></staff>
      <staff n="2"><layer n="1"><mRest/></layer></staff>
    </measure>
    <measure n="2" xml:id="m2">
      <staff n="1"><layer n="1"><note pname="g" oct="4" dur="1" xml:id="s5"/></layer></staff>
      <staff n="2"><layer n="1"><mRest/></layer></staff>
    </measure>
    <measure n="3" xml:id="m3">
      <staff n="1"><layer n="1"><mRest xml:id="s6"/></layer></staff>
      <staff n="2"><layer n="1"><mRest/></layer></staff>
    </measure>`;
  const beat = frac(1, 4);

  it("simile replaces exactly one beat (consuming sub-beat events) and toggles back to a rest", () => {
    const { score } = scoreFrom(mei(body));
    // s2+s3 (two eighths) = one beat: both consumed by the slash
    new BeatRepeatCommand("s2", beat, "4", frac(4, 4)).apply(ctxFor(score));
    const index = buildEventIndex(score);
    const ids = index.eventsAt(0, 1, 1);
    expect(index.byId.get(ids[1]!)?.tag).toBe("beatRpt");
    expect(ids).toHaveLength(3); // quarter, beatRpt, half
    expect(validateMeasureDurations(score.measures[0]!, { count: "4", unit: "4" }, 1)).toHaveLength(0);
    // toggle off -> a one-beat rest
    new BeatRepeatCommand(ids[1]!, beat, "4", frac(4, 4)).apply(ctxFor(score));
    const after = buildEventIndex(score).eventsAt(0, 1, 1);
    expect(buildEventIndex(score).byId.get(after[1]!)?.tag).toBe("rest");
  });

  it("simile refuses to cross the barline; revert is byte-identical", () => {
    const { score } = scoreFrom(mei(body));
    expect(() => new BeatRepeatCommand("s4", frac(1, 1), "1", frac(4, 4)).apply(ctxFor(score))).toThrow(/boundary/);
    const before = serialize(score.scoreEl);
    const cmd = new BeatRepeatCommand("s1", beat, "4", frac(4, 4));
    cmd.apply(ctxFor(score));
    cmd.revert(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(before);
  });

  it("measure repeat cycles content → % → %% (+mSpace next) → empty", () => {
    const { score } = scoreFrom(mei(body));
    const pos = { measureIndex: 1, staffN: 1, layerN: 1 };
    const layerTags = (m: number) => {
      const idx = buildEventIndex(score);
      return idx.eventsAt(m, 1, 1).map((id) => idx.byId.get(id)!.tag);
    };
    new MeasureRepeatCycleCommand(pos.measureIndex, pos.staffN, pos.layerN).apply(ctxFor(score));
    expect(layerTags(1)).toEqual(["mRpt"]);
    new MeasureRepeatCycleCommand(pos.measureIndex, pos.staffN, pos.layerN).apply(ctxFor(score));
    expect(layerTags(1)).toEqual(["mRpt2"]);
    expect(layerTags(2)).toEqual(["mSpace"]);
    new MeasureRepeatCycleCommand(pos.measureIndex, pos.staffN, pos.layerN).apply(ctxFor(score));
    expect(layerTags(1)).toEqual(["mRest"]);
    expect(layerTags(2)).toEqual(["mRest"]);
    // every state satisfied the duration invariant along the way
    expect(validateMeasureDurations(score.measures[1]!, { count: "4", unit: "4" }, 1)).toHaveLength(0);
  });

  it("%% at the last measure refuses; reverts restore exactly", () => {
    const { score } = scoreFrom(mei(body));
    new MeasureRepeatCycleCommand(2, 1, 1).apply(ctxFor(score)); // mRpt on m3
    const snap = serialize(score.scoreEl);
    expect(() => new MeasureRepeatCycleCommand(2, 1, 1).apply(ctxFor(score))).toThrow(/following measure/);
    expect(serialize(score.scoreEl)).toBe(snap);
    const cmd = new MeasureRepeatCycleCommand(1, 1, 1);
    const before2 = serialize(score.scoreEl);
    cmd.apply(ctxFor(score));
    cmd.revert(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(before2);
  });

  it("the o cycle walks coda → To Coda → segno → fine → dalSegno → daCapo → off", () => {
    const { score } = scoreFrom(mei(body));
    const before = serialize(score.scoreEl);
    const states = () =>
      findAll(score.measures[0]!, "repeatMark").map((r) => `${r.attrs["func"]}:${r.children.filter((c) => typeof c === "string").join("")}`);
    // To Coda shares func="coda" with the sign — the text is the difference
    const expected = ["coda:", "coda:To Coda", "segno:", "fine:", "dalSegno:", "daCapo:"];
    for (const want of expected) {
      new ToggleMarkCommand("s1", "coda").apply(ctxFor(score));
      expect(states()).toEqual([want]);
    }
    new ToggleMarkCommand("s1", "coda").apply(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(before);
  });
});

describe("TupletCommand", () => {
  const body = `
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="4" xml:id="t1"/><note pname="d" oct="4" dur="4" xml:id="t2"/><note pname="e" oct="4" dur="4" xml:id="t3"/><rest dur="4" xml:id="t4"/></layer></staff>
      <staff n="2"><layer n="1"><mRest/></layer></staff>
    </measure>`;
  const sextBody = `
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1">${[1, 2, 3, 4, 5, 6].map((i) => `<note pname="c" oct="4" dur="8" xml:id="x${i}"/>`).join("")}<note pname="g" oct="4" dur="4" xml:id="x7"/></layer></staff>
      <staff n="2"><layer n="1"><mRest/></layer></staff>
    </measure>`;

  it("3 quarters become a 3:2 triplet with the freed quarter as a rest", () => {
    const { score } = scoreFrom(mei(body));
    new TupletCommand(["t1", "t2", "t3"]).apply(ctxFor(score));
    const tuplets = findAll(score.measures[0]!, "tuplet");
    expect(tuplets).toHaveLength(1);
    expect(tuplets[0]!.attrs["num"]).toBe("3");
    expect(tuplets[0]!.attrs["numbase"]).toBe("2");
    expect(findAll(tuplets[0]!, "note")).toHaveLength(3);
    expect(validateMeasureDurations(score.measures[0]!, { count: "4", unit: "4" }, 1)).toHaveLength(0);
    const index = buildEventIndex(score);
    expect(index.byId.get("t2")?.eventIndex).toBe(1); // members still indexed
  });

  it("6 eighths become a 6:4 sextuplet; unwrap restores byte-identically", () => {
    const { score } = scoreFrom(mei(sextBody));
    const before = serialize(score.scoreEl);
    new TupletCommand(["x1", "x2", "x3", "x4", "x5", "x6"]).apply(ctxFor(score));
    const tuplet = findAll(score.measures[0]!, "tuplet")[0]!;
    expect(tuplet.attrs["num"]).toBe("6");
    expect(validateMeasureDurations(score.measures[0]!, { count: "4", unit: "4" }, 1)).toHaveLength(0);
    // selection inside the tuplet unwraps: freed rest consumed back
    new TupletCommand(["x1", "x2", "x3", "x4", "x5", "x6"]).apply(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(before);
  });

  it("refuses wrong counts, non-consecutive runs, and unwraps without rests", () => {
    const { score } = scoreFrom(mei(body));
    expect(() => new TupletCommand(["t1", "t2"]).apply(ctxFor(score))).toThrow(/3 notes.*6/);
    expect(() => new TupletCommand(["t1", "t2", "t4"]).apply(ctxFor(score))).toThrow(/consecutive/);
    // wrap, then delete the freed rest so the unwrap has nothing to consume
    new TupletCommand(["t1", "t2", "t3"]).apply(ctxFor(score));
    const idx = buildEventIndex(score);
    const layer = idx.eventsAt(0, 1, 1);
    // consume the two trailing rests by entering a half note over them
    const restId = layer[3]!;
    new ReplaceEntryCommand(restId, { kind: "note", pname: "g", oct: 4, dur: "2" }, frac(4, 4)).apply(ctxFor(score));
    expect(() => new TupletCommand(["t1", "t2", "t3"]).apply(ctxFor(score))).toThrow(/rests after/);
  });

  it("apply-then-revert is byte-identical (both directions)", () => {
    const { score } = scoreFrom(mei(body));
    const before = serialize(score.scoreEl);
    const wrap = new TupletCommand(["t1", "t2", "t3"]);
    wrap.apply(ctxFor(score));
    const wrapped = serialize(score.scoreEl);
    const un = new TupletCommand(["t1", "t2", "t3"]);
    un.apply(ctxFor(score));
    un.revert(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(wrapped);
    wrap.revert(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(before);
  });
});
