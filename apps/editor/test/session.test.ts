/**
 * The caret after an entry (the user, 2026-11-05): the next event as before
 * — and, at the last event of the last measure, a measure to come, so the
 * writing flows. The session appends it (`advanceAfterEntry`); the plan is
 * pure and tested here on a built score; the session itself needs the
 * browser's parser, so the e2e covers the whole.
 */
import { describe, it, expect } from "vitest";
import { buildEventIndex, buildScore, type CoreElement } from "@battuta/core";
import { planAdvance } from "../src/session";

const el = (tag: string, attrs: Record<string, string> = {}, ...children: CoreElement[]): CoreElement => ({ tag, attrs, children });
const measure = (n: string, ...events: CoreElement[]) => el("measure", { n, "xml:id": `m${n}` }, el("staff", { n: "1" }, el("layer", { n: "1" }, ...events)));
const note = (id: string) => el("note", { "xml:id": id, pname: "c", oct: "4", dur: "4" });
const score = (...measures: CoreElement[]) =>
  buildScore(el("music", {}, el("body", {}, el("mdiv", {}, el("score", {}, el("scoreDef", { "meter.count": "2", "meter.unit": "4" }, el("staffGrp", {}, el("staffDef", { n: "1", lines: "5", "clef.shape": "G", "clef.line": "2" }))), el("section", {}, ...measures))))));
const at = (measureIndex: number, eventIndex: number) => ({ measureIndex, staffN: 1, layerN: 1, eventIndex });

describe("the caret after an entry", () => {
  it("goes to the next event while there is one, into the next measure too", () => {
    const s = score(measure("1", note("a"), note("b")), measure("2", note("c")));
    const index = buildEventIndex(s);
    expect(planAdvance(index, s, at(0, 0))).toEqual({ caret: at(0, 1), grow: false });
    expect(planAdvance(index, s, at(0, 1))).toEqual({ caret: at(1, 0), grow: false });
  });

  it("at the last event of the last measure, a measure is to come, the caret on its first event", () => {
    const s = score(measure("1", note("a"), note("b")));
    expect(planAdvance(buildEventIndex(s), s, at(0, 1))).toEqual({ caret: at(1, 0), grow: true });
  });

  it("a voice that ends before the last measure stays where it is", () => {
    // Measure 2 has no layer for the voice: the voice ends in measure 1, the score does not.
    const s = score(measure("1", note("a")), el("measure", { n: "2", "xml:id": "m2" }, el("staff", { n: "1" })));
    expect(planAdvance(buildEventIndex(s), s, at(0, 0))).toEqual({ caret: at(0, 0), grow: false });
  });
});
