import { describe, it, expect } from "vitest";
import {
  buildEventIndex, serialize, frac, fEq, eventDuration, layerDuration, meterCapacity, validateMeasureDurations,
  normalizeBlock, copyBlock, fragmentToText, planPasteReplace,
  PasteReplaceMeasuresCommand, InsertMeasuresCommand, DeleteMeasuresCommand, DuplicateMeasuresCommand,
  CommandStack, findAll,
  type CommandContext,
  ChangeContextCommand, resolveContexts,
  AddStaffCommand, RemoveStaffCommand,
} from "../src/index.js";
import { scoreFrom, mei, measure, parse } from "./helpers.js";

const ctxFor = (score: ReturnType<typeof scoreFrom>["score"]): CommandContext => ({ score, index: buildEventIndex(score) });

describe("durations", () => {
  it("computes dotted and plain durations", () => {
    expect(fEq(eventDuration(parse(`<note dur="4"/>`))!, frac(1, 4))).toBe(true);
    expect(fEq(eventDuration(parse(`<note dur="4" dots="1"/>`))!, frac(3, 8))).toBe(true);
    expect(fEq(eventDuration(parse(`<note dur="8" dots="2"/>`))!, frac(7, 32))).toBe(true);
    expect(fEq(eventDuration(parse(`<note dur="breve"/>`))!, frac(2, 1))).toBe(true);
    expect(eventDuration(parse(`<note dur="4" grace="acc"/>`))!.num).toBe(0);
  });

  it("sums layers through beams and scales tuplets", () => {
    const layer = parse(`<layer>
      <beam><note dur="8"/><note dur="8"/></beam>
      <tuplet num="3" numbase="2"><note dur="8"/><note dur="8"/><note dur="8"/></tuplet>
      <rest dur="2"/>
    </layer>`);
    // 1/4 + (3×1/8 × 2/3 = 1/4) + 1/2 = 1
    expect(fEq(layerDuration(layer).total, frac(1, 1))).toBe(true);
  });

  it("meter capacity handles numeric and symbol meters", () => {
    expect(fEq(meterCapacity({ count: "6", unit: "8" })!, frac(3, 4))).toBe(true);
    expect(fEq(meterCapacity({ sym: "common" })!, frac(1, 1))).toBe(true);
  });

  it("validates measures and exempts mRest and metcon=false", () => {
    const bad = parse(`<measure><staff n="1"><layer n="1"><note dur="2"/></layer></staff></measure>`);
    expect(validateMeasureDurations(bad, { count: "4", unit: "4" })).toHaveLength(1);
    const mrest = parse(`<measure><staff n="1"><layer n="1"><mRest/></layer></staff></measure>`);
    expect(validateMeasureDurations(mrest, { count: "4", unit: "4" })).toHaveLength(0);
    const upbeat = parse(`<measure metcon="false"><staff n="1"><layer n="1"><note dur="2"/></layer></staff></measure>`);
    expect(validateMeasureDurations(upbeat, { count: "4", unit: "4" })).toHaveLength(0);
  });
});

describe("copyBlock / fragments", () => {
  const BODY = `${measure(1)} ${measure(2)} ${measure(3)}`;

  it("copies a measure×staff rectangle with context metadata", () => {
    const { score, contexts } = scoreFrom(mei(BODY, `meter.count="4" meter.unit="4" keysig="2s"`));
    const frag = copyBlock(score, contexts, normalizeBlock({ measureIndex: 0, staffN: 1 }, { measureIndex: 1, staffN: 2 }))!;
    expect(frag.measureCount).toBe(2);
    expect(frag.staves).toHaveLength(2);
    expect(frag.staves[0]!.keysig).toBe("2s");
    expect(frag.meter).toEqual({ count: "4", unit: "4" });
    expect(fragmentToText(frag)).toContain("battuta clipboard: 2 measure(s)");
  });

  it("copying is non-destructive and paste materialization renews all ids", () => {
    const { score, contexts } = scoreFrom(mei(BODY));
    const before = score.measures.map((m) => serialize(m)).join("");
    const frag = copyBlock(score, contexts, { measureFrom: 0, measureTo: 0, staffFrom: 1, staffTo: 1 })!;
    expect(score.measures.map((m) => serialize(m)).join("")).toBe(before);
    const ctx = ctxFor(score);
    new PasteReplaceMeasuresCommand(frag, 2, 1).apply(ctx);
    const allIds = findAll(score.measures[2]!, "note").map((n) => n.attrs["xml:id"]);
    const sourceIds = findAll(score.measures[0]!, "note").map((n) => n.attrs["xml:id"]);
    expect(allIds.some((id) => sourceIds.includes(id))).toBe(false); // no id reuse
  });
});

describe("planPasteReplace", () => {
  it("accepts an in-meter paste and rejects a duration mismatch", () => {
    const three4 = `<measure n="1" xml:id="s1"><staff n="1"><layer n="1"><note pname="c" oct="4" dur="2" xml:id="x1"/><note pname="d" oct="4" dur="4" xml:id="x2"/></layer></staff><staff n="2"><layer n="1"><mRest xml:id="x3"/></layer></staff></measure>`;
    const src = scoreFrom(mei(three4, `meter.count="3" meter.unit="4" keysig="0"`));
    const frag = copyBlock(src.score, src.contexts, { measureFrom: 0, measureTo: 0, staffFrom: 1, staffTo: 1 })!;

    const tgt44 = scoreFrom(mei(`${measure(1)} ${measure(2)}`));
    const plan = planPasteReplace(tgt44.score, tgt44.contexts, frag, 0, 1);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("duration mismatch");

    const tgt34 = scoreFrom(mei(three4.replace(/xml:id="[^"]*"/g, ""), `meter.count="3" meter.unit="4" keysig="1f"`));
    const plan2 = planPasteReplace(tgt34.score, tgt34.contexts, frag, 0, 1);
    expect(plan2.ok).toBe(true);
    if (plan2.ok) expect(plan2.warnings.some((w) => w.includes("key signature differs"))).toBe(true);
  });

  it("rejects blocks that exceed the score or the staff range", () => {
    const { score, contexts } = scoreFrom(mei(measure(1)));
    const frag = copyBlock(score, contexts, { measureFrom: 0, measureTo: 0, staffFrom: 1, staffTo: 2 })!;
    expect(planPasteReplace(score, contexts, frag, 1, 1).ok).toBe(false); // beyond last measure
    expect(planPasteReplace(score, contexts, frag, 0, 2).ok).toBe(false); // staff 3 missing
  });
});

describe("PasteReplaceMeasuresCommand", () => {
  it("replaces target staff content and restores byte-identically on revert", () => {
    const { score, contexts } = scoreFrom(mei(`${measure(1)} ${measure(2)} ${measure(3)}`));
    const snapshot = () => score.measures.map((m) => serialize(m)).join("\n");
    const before = snapshot();
    const frag = copyBlock(score, contexts, { measureFrom: 0, measureTo: 1, staffFrom: 1, staffTo: 1 })!;
    const ctx = ctxFor(score);
    const cmd = new PasteReplaceMeasuresCommand(frag, 1, 2); // staff 1 content -> staff 2 of m2..m3
    const dirty = cmd.apply(ctx);
    expect(dirty).toEqual([
      { measureIndex: 1, staffN: 2 },
      { measureIndex: 2, staffN: 2 },
    ]);
    // staff 2 of m2 now carries staff 1 of m1's note (c4 whole in helpers)
    const m2s2 = findAll(score.measures[1]!, "staff").find((s) => s.attrs["n"] === "2")!;
    expect(findAll(m2s2, "note")[0]!.attrs["oct"]).toBe("4"); // came from staff 1 (oct 4), not old staff 2 (oct 3)
    expect(m2s2.attrs["n"]).toBe("2");
    cmd.revert(ctx);
    expect(snapshot()).toBe(before);
  });
});

describe("structural measure commands", () => {
  const setup = () => {
    const { score, contexts } = scoreFrom(mei(`${measure(1)} ${measure(2)} ${measure(3)}`));
    const snapshot = () => score.measures.map((m) => serialize(m)).join("\n");
    return { score, contexts, snapshot, stack: new CommandStack() };
  };

  it("insert adds empty measures with the right staff shape; undo restores", () => {
    const { score, snapshot, stack } = setup();
    const before = snapshot();
    stack.execute(ctxFor(score), new InsertMeasuresCommand(1, 2));
    expect(score.measures).toHaveLength(5);
    expect(findAll(score.measures[1]!, "staff")).toHaveLength(2);
    expect(findAll(score.measures[1]!, "mRest")).toHaveLength(2);
    stack.undo(ctxFor(score));
    expect(snapshot()).toBe(before);
  });

  it("delete removes a range; undo restores positions exactly", () => {
    const { score, snapshot, stack } = setup();
    const before = snapshot();
    stack.execute(ctxFor(score), new DeleteMeasuresCommand(0, 2));
    expect(score.measures).toHaveLength(1);
    expect(score.measures[0]!.attrs["xml:id"]).toBe("m3");
    stack.undo(ctxFor(score));
    expect(snapshot()).toBe(before);
  });

  it("duplicate clones a range with fresh ids; undo restores", () => {
    const { score, snapshot, stack } = setup();
    const before = snapshot();
    stack.execute(ctxFor(score), new DuplicateMeasuresCommand(0, 2));
    expect(score.measures).toHaveLength(5);
    const origIds = findAll(score.measures[0]!, "note").map((n) => n.attrs["xml:id"]);
    const dupIds = findAll(score.measures[2]!, "note").map((n) => n.attrs["xml:id"]);
    expect(dupIds.some((id) => origIds.includes(id))).toBe(false);
    stack.undo(ctxFor(score));
    expect(snapshot()).toBe(before);
  });
});

describe("structural ops at context boundaries", () => {
  const body = `
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="1" xml:id="w1"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="v1"/></layer></staff>
    </measure>
    <measure n="2" xml:id="m2">
      <staff n="1"><layer n="1"><note pname="d" oct="4" dur="1" xml:id="w2"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="d" oct="3" dur="1" xml:id="v2"/></layer></staff>
    </measure>
    <measure n="3" xml:id="m3">
      <staff n="1"><layer n="1"><mRest xml:id="w3"/></layer></staff>
      <staff n="2"><layer n="1"><mRest xml:id="v3"/></layer></staff>
    </measure>`;

  const withMeterChange = () => {
    const { score } = scoreFrom(mei(body));
    // 7/8 from m3 (an mRest measure, so the plan allows it)
    new ChangeContextCommand(2, { meter: { count: "7", unit: "8" } }).apply({ score, index: buildEventIndex(score) });
    return score;
  };

  const allValid = (score: ReturnType<typeof withMeterChange>) => {
    const contexts = resolveContexts(score);
    return score.measures.every((m, i) => [...contexts[i]!].every(([staffN, c]) => validateMeasureDurations(m, c.meter, staffN).length === 0));
  };

  it("duplicating the measure before a meter change keeps the copy in its source region", () => {
    const score = withMeterChange();
    new DuplicateMeasuresCommand(1, 1).apply({ score, index: buildEventIndex(score) });
    const contexts = resolveContexts(score);
    expect(contexts[2]!.get(1)!.meter).toEqual({ count: "4", unit: "4" }); // the copy, NOT 7/8
    expect(contexts[3]!.get(1)!.meter).toEqual({ count: "7", unit: "8" }); // the def still bites
    expect(allValid(score)).toBe(true); // this was the fuzzer's counterexample shape
  });

  it("inserting before a meter change extends the old region", () => {
    const score = withMeterChange();
    new InsertMeasuresCommand(2, 1).apply({ score, index: buildEventIndex(score) });
    const contexts = resolveContexts(score);
    expect(contexts[2]!.get(1)!.meter).toEqual({ count: "4", unit: "4" });
    expect(contexts[3]!.get(1)!.meter).toEqual({ count: "7", unit: "8" });
    expect(allValid(score)).toBe(true);
  });
});

describe("staff commands", () => {
  const twoStaves = () => scoreFrom(mei(`
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="1" xml:id="s1a"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="s2a"/></layer></staff>
      <dynam staff="2" tstamp="1">p</dynam>
    </measure>
    <staffDef n="2" clef.shape="C" clef.line="4"/>
    <measure n="2" xml:id="m2">
      <staff n="1"><layer n="1"><note pname="d" oct="4" dur="1" xml:id="s1b"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="d" oct="3" dur="1" xml:id="s2b"/></layer></staff>
    </measure>`));

  it("add staff: new treble staffDef + mRest staff in every measure, context resolves", () => {
    const { score } = twoStaves();
    const cmd = new AddStaffCommand();
    cmd.apply({ score, index: buildEventIndex(score) });
    expect(cmd.staffN).toBe(3);
    const contexts = resolveContexts(score);
    expect(contexts[0]!.get(3)!.clef).toEqual({ shape: "G", line: 2 });
    expect(contexts[1]!.get(3)!.meter).toEqual({ count: "4", unit: "4" });
    for (const m of score.measures) {
      const staves = findAll(m, "staff").map((s) => s.attrs["n"]);
      expect(staves).toEqual(["1", "2", "3"]);
    }
    // every added staff holds an mRest: the duration invariant is safe
    score.measures.forEach((m, i) => {
      for (const [staffN, c] of contexts[i]!) expect(validateMeasureDurations(m, c.meter, staffN)).toHaveLength(0);
    });
  });

  it("remove staff: initial def, interleaved defs, measure staves, staff-anchored events", () => {
    const { score } = twoStaves();
    new RemoveStaffCommand(2).apply({ score, index: buildEventIndex(score) });
    expect(findAll(score.scoreEl, "staffDef").map((d) => d.attrs["n"])).toEqual(["1"]); // interleaved n=2 def gone too
    expect(findAll(score.scoreEl, "dynam")).toHaveLength(0); // staff-anchored control event gone
    for (const m of score.measures) expect(findAll(m, "staff").map((s) => s.attrs["n"])).toEqual(["1"]);
    const contexts = resolveContexts(score);
    expect(contexts[0]!.size).toBe(1);
  });

  it("refuses to remove the last staff; add/remove revert byte-identically", () => {
    const { score } = twoStaves();
    const before = serialize(score.scoreEl);
    const add = new AddStaffCommand();
    add.apply({ score, index: buildEventIndex(score) });
    add.revert({ score, index: buildEventIndex(score) });
    expect(serialize(score.scoreEl)).toBe(before);
    const rm = new RemoveStaffCommand(2);
    rm.apply({ score, index: buildEventIndex(score) });
    rm.revert({ score, index: buildEventIndex(score) });
    expect(serialize(score.scoreEl)).toBe(before);
    new RemoveStaffCommand(2).apply({ score, index: buildEventIndex(score) });
    expect(() => new RemoveStaffCommand(1).apply({ score, index: buildEventIndex(score) })).toThrow(/last staff/);
  });
});
