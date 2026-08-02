import { describe, it, expect } from "vitest";
import { buildEventIndex, caretLeft, caretRight, caretVertical, eventRange } from "../src/index.js";
import { scoreFrom, mei } from "./helpers.js";

/** 2 measures × 2 staves; staff 1 has two events per measure, staff 2 one. */
const BODY = `
  <measure n="1" xml:id="m1">
    <staff n="1"><layer n="1"><note pname="c" oct="4" dur="2" xml:id="a1"/><beam><note pname="d" oct="4" dur="4" xml:id="a2"/><note pname="e" oct="4" dur="4" xml:id="a3"/></beam></layer></staff>
    <staff n="2"><layer n="1"><chord dur="1" xml:id="b1"><note pname="c" oct="3" xml:id="b1n1"/><note pname="g" oct="3" xml:id="b1n2"/></chord></layer></staff>
  </measure>
  <measure n="2" xml:id="m2">
    <staff n="1"><layer n="1"><rest dur="2" xml:id="c1"/><note pname="f" oct="4" dur="2" xml:id="c2"/></layer></staff>
    <staff n="2"><layer n="1"><mRest xml:id="d1"/></layer></staff>
  </measure>`;

describe("buildEventIndex", () => {
  it("flattens beams and treats chords as single events", () => {
    const { score } = scoreFrom(mei(BODY));
    const index = buildEventIndex(score);
    expect(index.eventsAt(0, 1, 1)).toEqual(["a1", "a2", "a3"]);
    expect(index.eventsAt(0, 2, 1)).toEqual(["b1"]); // chord, not its notes
    expect(index.byId.get("b1n1")).toBeUndefined();
    expect(index.byId.get("a2")).toMatchObject({ measureIndex: 0, staffN: 1, layerN: 1, eventIndex: 1 });
    expect(index.eventsAt(1, 2, 1)).toEqual(["d1"]); // mRest is an event
  });
});

describe("caret navigation", () => {
  const setup = () => {
    const { score } = scoreFrom(mei(BODY));
    return { score, index: buildEventIndex(score) };
  };

  it("moves right through events and across the measure boundary", () => {
    const { score, index } = setup();
    let pos = { measureIndex: 0, staffN: 1, layerN: 1, eventIndex: 0 };
    pos = caretRight(index, score, pos)!;
    expect(index.eventIdAt(pos)).toBe("a2");
    pos = caretRight(index, score, pos)!;
    pos = caretRight(index, score, pos)!;
    expect(pos.measureIndex).toBe(1);
    expect(index.eventIdAt(pos)).toBe("c1");
    pos = caretRight(index, score, pos)!;
    expect(index.eventIdAt(pos)).toBe("c2");
    expect(caretRight(index, score, pos)).toBeNull(); // end of score
  });

  it("moves left back across the boundary", () => {
    const { score, index } = setup();
    let pos = { measureIndex: 1, staffN: 1, layerN: 1, eventIndex: 0 };
    pos = caretLeft(index, score, pos)!;
    expect(pos.measureIndex).toBe(0);
    expect(index.eventIdAt(pos)).toBe("a3");
  });

  it("moves between staves, clamping the event index", () => {
    const { index } = setup();
    const pos = { measureIndex: 0, staffN: 1, layerN: 1, eventIndex: 2 };
    const down = caretVertical(index, pos, 1)!;
    expect(down.staffN).toBe(2);
    expect(down.eventIndex).toBe(0); // staff 2 has one event; clamped
    const up = caretVertical(index, down, -1)!;
    expect(up.staffN).toBe(1);
    expect(caretVertical(index, down, 1)).toBeNull(); // no staff 3
  });
});

describe("eventRange", () => {
  it("returns the inclusive in-order range across measures", () => {
    const { score } = scoreFrom(mei(BODY));
    const index = buildEventIndex(score);
    const a = { measureIndex: 0, staffN: 1, layerN: 1, eventIndex: 1 };
    const b = { measureIndex: 1, staffN: 1, layerN: 1, eventIndex: 0 };
    expect(eventRange(index, score, a, b)).toEqual(["a2", "a3", "c1"]);
    expect(eventRange(index, score, b, a)).toEqual(["a2", "a3", "c1"]); // order-agnostic
    expect(eventRange(index, score, a, { ...b, staffN: 2 })).toEqual([]); // cross-staff -> empty
  });
});
