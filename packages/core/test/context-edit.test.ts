import { describe, it, expect } from "vitest";
import { buildEventIndex, serialize, resolveContexts, planContextChange, ChangeContextCommand, findAll, type CommandContext } from "../src/index.js";
import { scoreFrom, mei, measure } from "./helpers.js";

const ctxFor = (score: ReturnType<typeof scoreFrom>["score"]): CommandContext => ({ score, index: buildEventIndex(score) });

describe("ChangeContextCommand", () => {
  it("edits the INITIAL defs at measure 0 (attrs win, child elements removed)", () => {
    const xml = `<?xml version="1.0"?>
<mei xmlns="http://www.music-encoding.org/ns/mei">
  <music><body><mdiv><score>
    <scoreDef meter.count="4" meter.unit="4">
      <staffGrp>
        <staffDef n="1" lines="5" clef.shape="G" clef.line="2"><keySig sig="1f"/></staffDef>
        <staffDef n="2" lines="5" clef.shape="F" clef.line="4"/>
      </staffGrp>
    </scoreDef>
    <section>${measure(1)} ${measure(2)}</section>
  </score></mdiv></body></music></mei>`;
    const { score } = scoreFrom(xml);
    new ChangeContextCommand(0, { keysig: "3s", meter: { count: "3", unit: "4" } }).apply(ctxFor(score));
    const contexts = resolveContexts(score);
    expect(contexts[0]!.get(1)!.keysig).toBe("3s");
    expect(contexts[0]!.get(2)!.keysig).toBe("3s");
    expect(contexts[0]!.get(1)!.meter).toEqual({ count: "3", unit: "4" });
    // the per-staff <keySig sig="1f"> override is gone
    expect(findAll(score.scoreDef, "keySig")).toHaveLength(0);
  });

  it("inserts an interleaved scoreDef mid-piece and merges repeated changes", () => {
    const { score } = scoreFrom(mei(`${measure(1)} ${measure(2)} ${measure(3)}`));
    new ChangeContextCommand(1, { keysig: "2f" }).apply(ctxFor(score));
    let contexts = resolveContexts(score);
    expect(contexts[0]!.get(1)!.keysig).toBe("0");
    expect(contexts[1]!.get(1)!.keysig).toBe("2f");
    expect(contexts[2]!.get(1)!.keysig).toBe("2f");
    // change the key again at the same spot: merges, no def stacking
    new ChangeContextCommand(1, { keysig: "4s" }).apply(ctxFor(score));
    contexts = resolveContexts(score);
    expect(contexts[1]!.get(1)!.keysig).toBe("4s");
    const defs = score.items.filter((i) => i.kind === "def");
    expect(defs).toHaveLength(1);
  });

  it("clef changes are staff-local via an INLINE clef before the barline", () => {
    const { score } = scoreFrom(mei(`${measure(1)} ${measure(2)}`));
    new ChangeContextCommand(1, { clef: { shape: "C", line: 3 }, staffN: 2 }).apply(ctxFor(score));
    const contexts = resolveContexts(score);
    expect(contexts[1]!.get(2)!.clef).toEqual({ shape: "C", line: 3 });
    expect(contexts[1]!.get(1)!.clef).toEqual({ shape: "G", line: 2 }); // untouched
    expect(contexts[0]!.get(2)!.clef).toEqual({ shape: "F", line: 4 }); // before: unchanged
    // the encoding survives full-document renders: an inline <clef> at the
    // end of the PREVIOUS measure's staff-2 layer (not a staffDef)
    const clefs = findAll(score.measures[0]!, "clef");
    expect(clefs).toHaveLength(1);
    expect(clefs[0]!.attrs["shape"]).toBe("C");
    expect(score.items.filter((i) => i.kind === "def")).toHaveLength(0);
    // changing again MERGES into the same inline clef (no stacking)
    new ChangeContextCommand(1, { clef: { shape: "F", line: 3 }, staffN: 2 }).apply(ctxFor(score));
    expect(findAll(score.measures[0]!, "clef")).toHaveLength(1);
    expect(resolveContexts(score)[1]!.get(2)!.clef).toEqual({ shape: "F", line: 3 });
  });

  it("meter plan refuses when existing content no longer fits, allows mRests", () => {
    const body = `
      ${measure(1)}
      <measure n="2" xml:id="m2"><staff n="1"><layer n="1"><mRest/></layer></staff><staff n="2"><layer n="1"><mRest/></layer></staff></measure>`;
    const { score, contexts } = scoreFrom(mei(body));
    // m1 holds whole notes: 3/4 would break it
    expect(planContextChange(score, contexts, 0, { meter: { count: "3", unit: "4" } }).ok).toBe(false);
    // m2 is all mRests: any meter fits
    expect(planContextChange(score, contexts, 1, { meter: { count: "7", unit: "8" } }).ok).toBe(true);
    // a keysig change never needs duration validation
    expect(planContextChange(score, contexts, 0, { keysig: "5s" }).ok).toBe(true);
  });

  it("apply-then-revert restores the document byte-identically (both paths)", () => {
    const xml = mei(`${measure(1)} ${measure(2)}`, `meter.count="4" meter.unit="4" keysig="1s"`);
    const { score } = scoreFrom(xml);
    const snap = () => serialize(score.scoreEl);
    const before = snap();
    const initial = new ChangeContextCommand(0, { keysig: "4f", meter: { count: "6", unit: "8" }, clef: { shape: "C", line: 4 }, staffN: 1 });
    initial.apply(ctxFor(score));
    initial.revert(ctxFor(score));
    expect(snap()).toBe(before);
    const mid = new ChangeContextCommand(1, { keysig: "4f", clef: { shape: "C", line: 4 }, staffN: 1 });
    mid.apply(ctxFor(score));
    mid.revert(ctxFor(score));
    expect(snap()).toBe(before);
  });
});
