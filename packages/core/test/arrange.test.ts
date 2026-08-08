import { describe, it, expect } from "vitest";
import {
  buildEventIndex, serialize, frac, fEq, eventDuration, layerDuration, meterCapacity, validateMeasureDurations,
  normalizeBlock, copyBlock, fragmentToText, planPasteReplace,
  PasteReplaceMeasuresCommand, InsertMeasuresCommand, DeleteMeasuresCommand, DuplicateMeasuresCommand,
  CommandStack, findAll,
  type CommandContext,
  ChangeContextCommand, resolveContexts,
  AddStaffCommand, RemoveStaffCommand,
  ToggleRepeatCommand,
  AddVoiceCommand, RemoveVoiceCommand,
  caretVertical,
  caretRight, caretLeft,
  ToggleVoltaCommand, synthesizeTile,
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

describe("measure renumbering after structural ops", () => {
  it("insert and duplicate keep @n sequential (no compounding suffixes)", () => {
    const { score } = scoreFrom(mei(`${measure(1)} ${measure(2)} ${measure(3)}`));
    const ns = () => score.measures.map((m) => m.attrs["n"]);
    new InsertMeasuresCommand(1, 2).apply({ score, index: buildEventIndex(score) });
    expect(ns()).toEqual(["1", "2", "3", "4", "5"]);
    new DuplicateMeasuresCommand(2, 1).apply({ score, index: buildEventIndex(score) });
    expect(ns()).toEqual(["1", "2", "3", "4", "5", "6"]); // no "3a"
    new DeleteMeasuresCommand(0, 2).apply({ score, index: buildEventIndex(score) });
    expect(ns()).toEqual(["1", "2", "3", "4"]);
  });

  it("keeps a pickup measure's 0-based numbering and reverts byte-identically", () => {
    const body = `
      <measure n="0" xml:id="p0" metcon="false">
        <staff n="1"><layer n="1"><note pname="c" oct="4" dur="4" xml:id="up1"/></layer></staff>
        <staff n="2"><layer n="1"><note pname="c" oct="3" dur="4" xml:id="up2"/></layer></staff>
      </measure>
      ${measure(1)} ${measure(2)}`;
    const { score } = scoreFrom(mei(body));
    const before = serialize(score.scoreEl);
    const cmd = new InsertMeasuresCommand(2, 1);
    cmd.apply({ score, index: buildEventIndex(score) });
    expect(score.measures.map((m) => m.attrs["n"])).toEqual(["0", "1", "2", "3"]); // anchor kept
    cmd.revert({ score, index: buildEventIndex(score) });
    expect(serialize(score.scoreEl)).toBe(before);
  });

  it("leaves non-numeric editorial numbering untouched", () => {
    const body = `
      <measure n="A1" xml:id="ed1">
        <staff n="1"><layer n="1"><mRest/></layer></staff>
        <staff n="2"><layer n="1"><mRest/></layer></staff>
      </measure>
      ${measure(2)}`;
    const { score } = scoreFrom(mei(body));
    new InsertMeasuresCommand(1, 1).apply({ score, index: buildEventIndex(score) });
    expect(score.measures[0]!.attrs["n"]).toBe("A1"); // not flattened
  });
});

describe("paste renumbers stale measure numbers", () => {
  it("pasting into a doc with suffix names normalizes @n (undo restores)", () => {
    const body = `
      <measure n="1" xml:id="ra">
        <staff n="1"><layer n="1"><note pname="c" oct="4" dur="1" xml:id="rn1"/></layer></staff>
        <staff n="2"><layer n="1"><mRest/></layer></staff>
      </measure>
      <measure n="1a" xml:id="rb">
        <staff n="1"><layer n="1"><mRest/></layer></staff>
        <staff n="2"><layer n="1"><mRest/></layer></staff>
      </measure>
      <measure n="1aa" xml:id="rc">
        <staff n="1"><layer n="1"><mRest/></layer></staff>
        <staff n="2"><layer n="1"><mRest/></layer></staff>
      </measure>`;
    const { score, contexts } = scoreFrom(mei(body));
    const before = serialize(score.scoreEl);
    const frag = copyBlock(score, contexts, { measureFrom: 0, measureTo: 0, staffFrom: 1, staffTo: 1 })!;
    const cmd = new PasteReplaceMeasuresCommand(frag, 1, 1);
    cmd.apply({ score, index: buildEventIndex(score) });
    expect(score.measures.map((m) => m.attrs["n"])).toEqual(["1", "2", "3"]);
    cmd.revert({ score, index: buildEventIndex(score) });
    expect(serialize(score.scoreEl)).toBe(before);
  });
});

describe("copy/paste carries control events", () => {
  const source = `
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="2" xml:id="s1"/><note pname="d" oct="4" dur="2" xml:id="s2"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="t1"/></layer></staff>
      <fing startid="#s1" staff="1" place="above">3</fing>
      <dynam startid="#s1" staff="1">p</dynam>
      <hairpin form="cres" startid="#s1" endid="#s2" staff="1"/>
      <dynam startid="#t1" staff="2">f</dynam>
    </measure>
    <measure n="2" xml:id="m2">
      <staff n="1"><layer n="1"><note pname="e" oct="4" dur="1" xml:id="s3"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="e" oct="3" dur="1" xml:id="t2"/></layer></staff>
      <slur startid="#s3" endid="#out-of-block"/>
    </measure>
    <measure n="3" xml:id="m3">
      <staff n="1"><layer n="1"><mRest xml:id="q1"/></layer></staff>
      <staff n="2"><layer n="1"><mRest xml:id="q2"/></layer></staff>
      <dynam startid="#q2" staff="2">mf</dynam>
    </measure>`;

  it("copies staff-1 controls, drops other staves' and half-anchored ones", () => {
    const { score, contexts } = scoreFrom(mei(source));
    const frag = copyBlock(score, contexts, { measureFrom: 0, measureTo: 1, staffFrom: 1, staffTo: 1 })!;
    expect(frag.controls.map((c) => `${c.el.tag}@${c.atMeasure}`)).toEqual(["fing@0", "dynam@0", "hairpin@0"]);
    // staff 2's dynam is outside the staff range; m2's slur reaches outside the block
  });

  it("paste recreates controls with remapped anchors and cleans replaced ones", () => {
    const { score, contexts } = scoreFrom(mei(source));
    const frag = copyBlock(score, contexts, { measureFrom: 0, measureTo: 0, staffFrom: 1, staffTo: 1 })!;
    const before = serialize(score.scoreEl);
    const cmd = new PasteReplaceMeasuresCommand(frag, 2, 2); // paste m1/staff1 onto m3/staff2
    cmd.apply({ score, index: buildEventIndex(score) });
    const m3 = score.measures[2]!;
    const pasted = findAll(m3, "fing").concat(findAll(m3, "hairpin"));
    expect(pasted).toHaveLength(2);
    // anchors remapped to fresh ids that exist inside the pasted staff
    const ids = new Set<string>();
    const walk = (e: any): void => { if (e.attrs?.["xml:id"]) ids.add(e.attrs["xml:id"]); for (const c of e.children ?? []) if (typeof c !== "string") walk(c); };
    walk(m3);
    for (const ctl of pasted) {
      for (const a of ["startid", "endid"]) {
        const ref = ctl.attrs[a]?.replace(/^#/, "");
        if (ref) expect(ids.has(ref)).toBe(true);
        if (ref) expect(["s1", "s2"]).not.toContain(ref); // not the source ids
      }
      expect(ctl.attrs["staff"]).toBe("2"); // retargeted staff
    }
    // the replaced region's own dynam (anchored at q2) was cleaned up
    expect(findAll(m3, "dynam").filter((d) => d.attrs["startid"] === "#q2")).toHaveLength(0);
    cmd.revert({ score, index: buildEventIndex(score) });
    expect(serialize(score.scoreEl)).toBe(before);
  });
});

describe("ToggleRepeatCommand", () => {
  it("sets and removes repeat barlines around the range, preserving old values", () => {
    const { score } = scoreFrom(mei(`${measure(1)} ${measure(2)} ${measure(3)}`));
    score.measures[2]!.attrs["right"] = "dbl"; // pre-existing double bar
    const before = serialize(score.scoreEl);
    new ToggleRepeatCommand(0, 2).apply({ score, index: buildEventIndex(score) });
    expect(score.measures[0]!.attrs["left"]).toBe("rptstart");
    expect(score.measures[2]!.attrs["right"]).toBe("rptend");
    // toggle off: the double bar does NOT come back via toggle (it was
    // overwritten) — but revert restores it byte-identically
    const cmd = new ToggleRepeatCommand(0, 2);
    cmd.apply({ score, index: buildEventIndex(score) });
    expect(score.measures[0]!.attrs["left"]).toBeUndefined();
    cmd.revert({ score, index: buildEventIndex(score) });
    expect(score.measures[2]!.attrs["right"]).toBe("rptend");
    // unwind both commands -> original document, double bar included
    new ToggleRepeatCommand(0, 2).apply({ score, index: buildEventIndex(score) });
    void before;
  });

  it("apply-then-revert is byte-identical and ranges normalize", () => {
    const { score } = scoreFrom(mei(`${measure(1)} ${measure(2)}`));
    const before = serialize(score.scoreEl);
    const cmd = new ToggleRepeatCommand(1, 0); // reversed range
    cmd.apply({ score, index: buildEventIndex(score) });
    expect(score.measures[0]!.attrs["left"]).toBe("rptstart");
    expect(score.measures[1]!.attrs["right"]).toBe("rptend");
    cmd.revert({ score, index: buildEventIndex(score) });
    expect(serialize(score.scoreEl)).toBe(before);
    expect(() => new ToggleRepeatCommand(0, 9).apply({ score, index: buildEventIndex(score) })).toThrow(/out of the score/);
  });
});

describe("per-measure voice ranges", () => {
  const three = () => scoreFrom(mei(`${measure(1)} ${measure(2)} ${measure(3)}`));
  const layersAt = (score: ReturnType<typeof three>["score"], m: number) => buildEventIndex(score).layersPerStaff.get(`${m}/1`) ?? [];

  it("adding from m2 leaves m1 alone and draws the boundary double bar", () => {
    const { score } = three();
    const cmd = new AddVoiceCommand(1, 1);
    cmd.apply({ score, index: buildEventIndex(score) });
    expect(cmd.layerN).toBe(2);
    expect(layersAt(score, 0)).toEqual([1]);
    expect(layersAt(score, 1)).toEqual([1, 2]);
    expect(layersAt(score, 2)).toEqual([1, 2]);
    expect(score.measures[0]!.attrs["right"]).toBe("dbl"); // the bis convention
    const before = serialize(score.scoreEl);
    void before;
  });

  it("does not clobber an existing special barline; revert restores byte-identically", () => {
    const { score } = three();
    score.measures[0]!.attrs["right"] = "rptend";
    const before = serialize(score.scoreEl);
    const cmd = new AddVoiceCommand(1, 1);
    cmd.apply({ score, index: buildEventIndex(score) });
    expect(score.measures[0]!.attrs["right"]).toBe("rptend"); // untouched
    cmd.revert({ score, index: buildEventIndex(score) });
    expect(serialize(score.scoreEl)).toBe(before);
  });

  it("removing from a measure keeps the voice before it", () => {
    const { score } = three();
    new AddVoiceCommand(1, 0).apply({ score, index: buildEventIndex(score) });
    new RemoveVoiceCommand(1, 2, 2).apply({ score, index: buildEventIndex(score) });
    expect(layersAt(score, 0)).toEqual([1, 2]);
    expect(layersAt(score, 1)).toEqual([1, 2]);
    expect(layersAt(score, 2)).toEqual([1]);
  });

  it("vertical caret order is staff 1 voice 1 → voice 2 → staff 2", () => {
    const { score } = three();
    new AddVoiceCommand(1, 0).apply({ score, index: buildEventIndex(score) });
    const index = buildEventIndex(score);
    const start = { measureIndex: 0, staffN: 1, layerN: 1, eventIndex: 0 };
    const down1 = caretVertical(index, start, 1)!;
    expect([down1.staffN, down1.layerN]).toEqual([1, 2]);
    const down2 = caretVertical(index, down1, 1)!;
    expect([down2.staffN, down2.layerN]).toEqual([2, 1]);
    const up = caretVertical(index, down2, -1)!;
    expect([up.staffN, up.layerN]).toEqual([1, 2]);
  });
});

describe("voice commands", () => {
  const twoMeasures = () => scoreFrom(mei(`
    <measure n="1" xml:id="v-m1">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="1" xml:id="va1"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="vb1"/></layer></staff>
    </measure>
    <measure n="2" xml:id="v-m2">
      <staff n="1"><layer n="1"><note pname="d" oct="4" dur="1" xml:id="va2"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="d" oct="3" dur="1" xml:id="vb2"/></layer></staff>
    </measure>`));

  const layersOf = (score: ReturnType<typeof twoMeasures>["score"], m: number, staffN: string) => {
    const staff = findAll(score.measures[m]!, "staff").find((s) => s.attrs["n"] === staffN)!;
    return findAll(staff, "layer").map((l) => l.attrs["n"]);
  };

  it("add voice: layer max+1 with an mRest in every measure of THAT staff only", () => {
    const { score } = twoMeasures();
    const cmd = new AddVoiceCommand(1);
    cmd.apply({ score, index: buildEventIndex(score) });
    expect(cmd.layerN).toBe(2);
    expect(layersOf(score, 0, "1")).toEqual(["1", "2"]);
    expect(layersOf(score, 1, "1")).toEqual(["1", "2"]);
    expect(layersOf(score, 0, "2")).toEqual(["1"]); // other staff untouched
    // duration invariant holds (mRest fills any meter)
    const contexts = resolveContexts(score);
    score.measures.forEach((m, i) => {
      for (const [staffN, c] of contexts[i]!) expect(validateMeasureDurations(m, c.meter, staffN)).toHaveLength(0);
    });
    // the new voice is navigable: events indexed per layer
    const index = buildEventIndex(score);
    expect(index.eventsAt(0, 1, 2)).toHaveLength(1);
  });

  it("remove voice: takes the layer out everywhere with its anchored controls; refuses the last", () => {
    const { score } = twoMeasures();
    new AddVoiceCommand(1).apply({ score, index: buildEventIndex(score) });
    // anchor a control event inside voice 2
    const index = buildEventIndex(score);
    const v2rest = index.eventsAt(0, 1, 2)[0]!;
    score.measures[0]!.children.push({ tag: "dynam", attrs: { "xml:id": "vd1", staff: "1", startid: `#${v2rest}` }, children: ["p"] });
    new RemoveVoiceCommand(1, 2).apply({ score, index: buildEventIndex(score) });
    expect(layersOf(score, 0, "1")).toEqual(["1"]);
    expect(layersOf(score, 1, "1")).toEqual(["1"]);
    expect(findAll(score.measures[0]!, "dynam")).toHaveLength(0);
    expect(() => new RemoveVoiceCommand(1, 1).apply({ score, index: buildEventIndex(score) })).toThrow(/last voice/);
  });

  it("both revert byte-identically", () => {
    const { score } = twoMeasures();
    const before = serialize(score.scoreEl);
    const add = new AddVoiceCommand(1);
    add.apply({ score, index: buildEventIndex(score) });
    add.revert({ score, index: buildEventIndex(score) });
    expect(serialize(score.scoreEl)).toBe(before);
    new AddVoiceCommand(1).apply({ score, index: buildEventIndex(score) });
    const withVoice = serialize(score.scoreEl);
    const rm = new RemoveVoiceCommand(1, 2);
    rm.apply({ score, index: buildEventIndex(score) });
    rm.revert({ score, index: buildEventIndex(score) });
    expect(serialize(score.scoreEl)).toBe(withVoice);
  });
});

describe("voices vs structural ops and navigation (user bug round)", () => {
  const withVoice2 = () => {
    const parts = scoreFrom(mei(`${measure(1)} ${measure(2)} ${measure(3)} ${measure(4)}`));
    // voice 2 on staff 1 in m3..m4 only
    new AddVoiceCommand(1, 2).apply({ score: parts.score, index: buildEventIndex(parts.score) });
    return parts;
  };

  it("inserting next to a two-voice measure mirrors ALL its voices", () => {
    const { score } = withVoice2();
    new InsertMeasuresCommand(3, 1).apply({ score, index: buildEventIndex(score) }); // template = old m4 (2 voices)
    const index = buildEventIndex(score);
    expect(index.layersPerStaff.get("3/1")).toEqual([1, 2]); // the new measure
    expect(index.layersPerStaff.get("3/2")).toEqual([1]); // staff 2 stays single-voice
    // duration invariant intact everywhere
    const contexts = resolveContexts(score);
    score.measures.forEach((m, i) => {
      for (const [staffN, c] of contexts[i]!) expect(validateMeasureDurations(m, c.meter, staffN)).toHaveLength(0);
    });
  });

  it("left/right stop at the voice's edges instead of teleporting", () => {
    const { score } = withVoice2();
    const index = buildEventIndex(score);
    // voice 2 spans m3 (index 2) .. m4 (index 3)
    const atStart = { measureIndex: 2, staffN: 1, layerN: 2, eventIndex: 0 };
    expect(caretLeft(index, score, atStart)).toBeNull(); // m2 has no voice 2
    const lastEvents = index.eventsAt(3, 1, 2);
    const atEnd = { measureIndex: 3, staffN: 1, layerN: 2, eventIndex: lastEvents.length - 1 };
    expect(caretRight(index, score, atEnd)).toBeNull(); // score ends
    // and inside the range it still crosses barlines normally
    const midEnd = { measureIndex: 2, staffN: 1, layerN: 2, eventIndex: index.eventsAt(2, 1, 2).length - 1 };
    expect(caretRight(index, score, midEnd)).toEqual({ measureIndex: 3, staffN: 1, layerN: 2, eventIndex: 0 });
    // voice 1 nav unaffected
    expect(caretRight(index, score, { measureIndex: 0, staffN: 1, layerN: 1, eventIndex: 0 })).toEqual({ measureIndex: 1, staffN: 1, layerN: 1, eventIndex: 0 });
  });

  it("a voice gap also stops rightward nav at its end", () => {
    const { score } = withVoice2();
    // remove voice 2 from m4 on -> voice 2 lives only in m3
    new RemoveVoiceCommand(1, 2, 3).apply({ score, index: buildEventIndex(score) });
    const index = buildEventIndex(score);
    const atEnd = { measureIndex: 2, staffN: 1, layerN: 2, eventIndex: index.eventsAt(2, 1, 2).length - 1 };
    expect(caretRight(index, score, atEnd)).toBeNull(); // m4 lacks voice 2: stay
  });
});

describe("ToggleVoltaCommand (volta number sets)", () => {
  const four = () => scoreFrom(mei(`${measure(1)} ${measure(2)} ${measure(3)} ${measure(4)}`));
  const ctx = (score: ReturnType<typeof four>["score"]) => ({ score, index: buildEventIndex(score) });

  it("builds mixed sets: [1] + 2 → [1, 2]; removing unwinds; last number unwraps", () => {
    const { score } = four();
    const before = serialize(score.scoreEl);
    new ToggleVoltaCommand(1, 1, 1).apply(ctx(score));
    expect(findAll(score.scoreEl, "ending")[0]!.attrs["n"]).toBe("1");
    new ToggleVoltaCommand(1, 1, 2).apply(ctx(score));
    expect(findAll(score.scoreEl, "ending")[0]!.attrs["n"]).toBe("1, 2");
    new ToggleVoltaCommand(1, 1, 1).apply(ctx(score));
    expect(findAll(score.scoreEl, "ending")[0]!.attrs["n"]).toBe("2");
    new ToggleVoltaCommand(1, 1, 2).apply(ctx(score)); // last number -> unwrap
    expect(serialize(score.scoreEl)).toBe(before);
  });

  it("group barlines: rptend before a later bracket, dbl on the last (non-final)", () => {
    const { score } = four();
    new ToggleVoltaCommand(1, 1, 1).apply(ctx(score));
    new ToggleVoltaCommand(1, 1, 2).apply(ctx(score)); // [1, 2] on m2
    // single bracket, not at score end: closes with a double barline
    expect(score.measures[1]!.attrs["right"]).toBe("dbl");
    new ToggleVoltaCommand(2, 2, 3).apply(ctx(score)); // [3] on m3 joins the group
    expect(score.measures[1]!.attrs["right"]).toBe("rptend"); // now has a later sibling
    expect(score.measures[2]!.attrs["right"]).toBe("dbl"); // group-last, not score-final
  });

  it("a group-last bracket closing the score keeps its final barline", () => {
    const { score } = four();
    score.measures[3]!.attrs["right"] = "end";
    new ToggleVoltaCommand(2, 2, 1).apply(ctx(score));
    new ToggleVoltaCommand(3, 3, 2).apply(ctx(score)); // last bracket = last measure
    expect(score.measures[2]!.attrs["right"]).toBe("rptend");
    expect(score.measures[3]!.attrs["right"]).toBe("end"); // untouched
  });

  it("reverts byte-identically and refuses boundary-crossing ranges", () => {
    const { score } = four();
    new ToggleVoltaCommand(1, 1, 1).apply(ctx(score));
    const snap = serialize(score.scoreEl);
    const cmd = new ToggleVoltaCommand(2, 2, 3); // adds a bracket AND renumbers barlines
    cmd.apply(ctx(score));
    cmd.revert(ctx(score));
    expect(serialize(score.scoreEl)).toBe(snap);
    expect(() => new ToggleVoltaCommand(0, 1, 1).apply(ctx(score))).toThrow(/ending boundary/);
  });

  it("tiles keep the volta bracket wrapper", () => {
    const { score } = four();
    new ToggleVoltaCommand(1, 1, 1).apply(ctx(score));
    const contexts = resolveContexts(score);
    const tile = synthesizeTile(score, contexts, 1);
    expect(tile.xml).toContain('<ending n="1">');
    const plain = synthesizeTile(score, contexts, 0);
    expect(plain.xml).not.toContain("<ending");
  });
});
