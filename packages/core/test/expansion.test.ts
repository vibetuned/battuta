import { describe, it, expect } from "vitest";
import { buildExpansion } from "../src/index.js";
import { scoreFrom, mei } from "./helpers.js";

const m = (n: number, extra = "", note = `<note pname="c" oct="4" dur="2" xml:id="n${n}"/>`) =>
  `<measure xml:id="m${n}" n="${n}"${extra}><staff n="1"><layer n="1">${note}</layer></staff></measure>`;

const plistOf = (plan: NonNullable<ReturnType<typeof buildExpansion>>): string[] => {
  const exp = plan.section.children[0];
  if (typeof exp === "string") throw new Error("expansion missing");
  return exp.attrs["plist"]!.split(" ");
};

/** Measure ids (in order) inside the segment a plist ref points at. */
const segMeasures = (plan: NonNullable<ReturnType<typeof buildExpansion>>, ref: string): string[] => {
  const el = plan.section.children.find((c) => typeof c !== "string" && c.attrs["xml:id"] === ref.slice(1));
  if (!el || typeof el === "string") throw new Error(`segment ${ref} not found`);
  return el.children.filter((c): c is Exclude<typeof c, string> => typeof c !== "string" && c.tag === "measure").map((c) => c.attrs["xml:id"]!);
};

/** The full measure sequence the plist plays. */
const playedMeasures = (plan: NonNullable<ReturnType<typeof buildExpansion>>): string[] => plistOf(plan).flatMap((ref) => segMeasures(plan, ref));

describe("buildExpansion", () => {
  it("returns null when the score has no repeat structure", () => {
    const { score } = scoreFrom(mei(m(1) + m(2)));
    expect(buildExpansion(score)).toBeNull();
  });

  it("returns null for a plain repeat only (Verovio auto-expands those)", () => {
    // no endings, no jump marks: unexpanded playback already repeats
    const { score } = scoreFrom(mei(m(1, ' left="rptstart"') + m(2, ' right="rptend"') + m(3)));
    const plan = buildExpansion(score);
    // encoding it anyway would ALSO be correct; the contract is just: if a
    // plan is returned, it must play m1 m2 m1 m2 m3
    if (plan) expect(playedMeasures(plan)).toEqual(["m1", "m2", "m1", "m2", "m3"]);
    else expect(plan).toBeNull();
  });

  it("unrolls volta passes: pre + [1], pre + [2], rest", () => {
    const { score } = scoreFrom(
      mei(m(1) + `<ending xml:id="e1" n="1">${m(2, ' right="rptend"')}</ending>` + `<ending xml:id="e2" n="2">${m(3)}</ending>` + m(4)),
    );
    const plan = buildExpansion(score);
    expect(plan).not.toBeNull();
    expect(playedMeasures(plan!)).toEqual(["m1", "m2", "m1", "m3", "m4"]);
  });

  it("handles number sets like [1, 2][3] (three passes)", () => {
    const { score } = scoreFrom(
      mei(m(1) + `<ending xml:id="e1" n="1, 2">${m(2, ' right="rptend"')}</ending>` + `<ending xml:id="e2" n="3">${m(3)}</ending>`),
    );
    const plan = buildExpansion(score);
    expect(plan).not.toBeNull();
    expect(playedMeasures(plan!)).toEqual(["m1", "m2", "m1", "m2", "m1", "m3"]);
  });

  it("volta repeats go back to a rptstart, not the piece start", () => {
    const { score } = scoreFrom(
      mei(m(1) + m(2, ' left="rptstart"') + `<ending xml:id="e1" n="1">${m(3, ' right="rptend"')}</ending>` + `<ending xml:id="e2" n="2">${m(4)}</ending>`),
    );
    const plan = buildExpansion(score);
    expect(plan).not.toBeNull();
    expect(playedMeasures(plan!)).toEqual(["m1", "m2", "m3", "m2", "m4"]);
  });

  it("da capo al fine: recap from the top to the fine, repeats ignored", () => {
    const body =
      m(1, "", `<note pname="c" oct="4" dur="2" xml:id="n1"/></layer></staff><repeatMark xml:id="rmF" func="fine" startid="#n1"/><staff n="1"><layer n="1">`) +
      m(2, ' left="rptstart"') +
      m(3, ' right="rptend"') +
      m(4, "", `<note pname="e" oct="4" dur="2" xml:id="n4"/></layer></staff><repeatMark xml:id="rmD" func="daCapo" startid="#n4"/><staff n="1"><layer n="1">`);
    const { score } = scoreFrom(mei(body));
    const plan = buildExpansion(score);
    expect(plan).not.toBeNull();
    expect(playedMeasures(plan!)).toEqual(["m1", "m2", "m3", "m2", "m3", "m4", "m1"]);
  });

  it("dal segno: recap starts at the segno, final endings only", () => {
    const body =
      m(1) +
      m(2, "", `<note pname="d" oct="4" dur="2" xml:id="n2"/></layer></staff><repeatMark xml:id="rmS" func="segno" startid="#n2"/><staff n="1"><layer n="1">`) +
      `<ending xml:id="e1" n="1">${m(3, ' right="rptend"')}</ending>` +
      `<ending xml:id="e2" n="2">${m(4)}</ending>` +
      m(5, "", `<note pname="g" oct="4" dur="2" xml:id="n5"/></layer></staff><repeatMark xml:id="rmD" func="dalSegno" startid="#n5"/><staff n="1"><layer n="1">`);
    const { score } = scoreFrom(mei(body));
    const plan = buildExpansion(score);
    expect(plan).not.toBeNull();
    // base: no rptstart, so the volta loops to the TOP — m1 m2 [1: m3],
    // m1 m2 [2: m4], m5 · recap from the segno: m2 m4 m5 (final ending)
    expect(playedMeasures(plan!)).toEqual(["m1", "m2", "m3", "m1", "m2", "m4", "m5", "m2", "m4", "m5"]);
  });

  it("da capo al Coda: recap jumps from the To Coda marker to the sign", () => {
    const withMark = (n: number, mark: string) =>
      m(n, "", `<note pname="c" oct="4" dur="2" xml:id="c${n}"/></layer></staff>${mark}<staff n="1"><layer n="1">`);
    const body =
      m(1) +
      withMark(2, `<repeatMark xml:id="rmT" func="coda" startid="#c2">To Coda</repeatMark>`) +
      m(3) +
      withMark(4, `<repeatMark xml:id="rmC" func="coda" startid="#c4"/>`) +
      withMark(5, `<repeatMark xml:id="rmD" func="daCapo" startid="#c5"/>`);
    // the coda SIGN must start its measure's segment: put it on m4's note,
    // which is the segment start after m3 — markFuncs reads the measure
    const { score } = scoreFrom(mei(body));
    const plan = buildExpansion(score);
    expect(plan).not.toBeNull();
    // base: m1..m5 (markers inert) · recap: m1 m2 → jump → m4 m5
    expect(playedMeasures(plan!)).toEqual(["m1", "m2", "m3", "m4", "m5", "m1", "m2", "m4", "m5"]);
  });

  it("the D.C. cuts the first pass: the coda after it plays only via To Coda", () => {
    // the REAL engraved layout: … To Coda … D.C. | 𝄌 coda … end
    const withMark = (n: number, mark: string) =>
      m(n, "", `<note pname="c" oct="4" dur="2" xml:id="d${n}"/></layer></staff>${mark}<staff n="1"><layer n="1">`);
    const body =
      m(1) +
      withMark(2, `<repeatMark xml:id="rmT" func="coda" startid="#d2">To Coda</repeatMark>`) +
      withMark(3, `<repeatMark xml:id="rmD" func="daCapo" startid="#d3"/>`) +
      withMark(4, `<repeatMark xml:id="rmC" func="coda" startid="#d4"/>`) +
      m(5);
    const { score } = scoreFrom(mei(body));
    const plan = buildExpansion(score);
    expect(plan).not.toBeNull();
    // base STOPS at the D.C. (m4/m5 not played) · recap: m1 m2 → 𝄌 → m4 m5
    expect(playedMeasures(plan!)).toEqual(["m1", "m2", "m3", "m1", "m2", "m4", "m5"]);
  });

  it("a plain mid-score D.C. replays to its own measure and stops", () => {
    const body =
      m(1) +
      m(2, "", `<note pname="c" oct="4" dur="2" xml:id="p2"/></layer></staff><repeatMark xml:id="rmD" func="daCapo" startid="#p2"/><staff n="1"><layer n="1">`) +
      m(3); // trailing material without a coda sign is unreachable
    const { score } = scoreFrom(mei(body));
    const plan = buildExpansion(score);
    expect(plan).not.toBeNull();
    expect(playedMeasures(plan!)).toEqual(["m1", "m2", "m1", "m2"]);
  });

  it("refuses two jump marks (out of scope) with null", () => {
    const dc = (n: number, id: string) =>
      m(n, "", `<note pname="c" oct="4" dur="2" xml:id="x${n}"/></layer></staff><repeatMark xml:id="${id}" func="daCapo" startid="#x${n}"/><staff n="1"><layer n="1">`);
    const { score } = scoreFrom(mei(m(1) + dc(2, "rm1") + dc(3, "rm2")));
    expect(buildExpansion(score)).toBeNull();
  });

  it("refuses dal segno without a segno", () => {
    const body = m(1) + m(2, "", `<note pname="c" oct="4" dur="2" xml:id="x2"/></layer></staff><repeatMark xml:id="rm" func="dalSegno" startid="#x2"/><staff n="1"><layer n="1">`);
    const { score } = scoreFrom(mei(body));
    expect(buildExpansion(score)).toBeNull();
  });

  it("never mutates the document (serialization unchanged)", async () => {
    const { serialize } = await import("../src/index.js");
    const { score } = scoreFrom(
      mei(m(1) + `<ending xml:id="e1" n="1">${m(2, ' right="rptend"')}</ending>` + `<ending xml:id="e2" n="2">${m(3)}</ending>`),
    );
    const before = serialize(score.scoreEl);
    buildExpansion(score);
    expect(serialize(score.scoreEl)).toBe(before);
  });
});
