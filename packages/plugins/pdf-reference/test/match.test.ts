/**
 * Matching the score's measures to the annotated ones: by id when at
 * least half of what could match does — exact whatever the order — and in
 * reading order otherwise, with the count of what was placed.
 */
import { describe, it, expect } from "vitest";
import { readAnnotations } from "../src/annotations";
import { matchMeasures, measureFor } from "../src/match";

const ann = readAnnotations([
  { name: "x_page1.json", text: JSON.stringify({ width: 100, height: 100, annotations: [{ class: "system", bbox: [0, 0, 100, 50] }, ...["a", "b", "c", "d"].map((id, i) => ({ class: "measure", id, bbox: [i * 20, 0, i * 20 + 20, 50] }))] }) },
]).annotations!;

describe("matching", () => {
  it("by id when the score carries the ids, whatever their order", () => {
    const m = matchMeasures(ann, ["c", "a", null, "d"]);
    expect(m.mode).toBe("id");
    expect(m.byIndex.map((x) => x?.id ?? null)).toEqual(["c", "a", null, "d"]);
    expect(m.matched).toBe(3);
    expect(measureFor(ann, m, 0, "c")?.id).toBe("c");
    expect(measureFor(ann, m, 0, "b")?.id).toBe("b"); // a tile is found by ITS id
    expect(measureFor(ann, m, 0, null)).toBeNull();
  });

  it("in order when the ids are not the annotated ones, or too few are", () => {
    const m = matchMeasures(ann, ["m1", "m2", "m3"]);
    expect(m.mode).toBe("order");
    expect(m.byIndex.map((x) => x?.id)).toEqual(["a", "b", "c"]);
    expect(measureFor(ann, m, 2, "anything")?.id).toBe("c");
    const longer = matchMeasures(ann, ["m1", "m2", "m3", "m4", "m5", "m6"]);
    expect(longer.matched).toBe(4);
    expect(longer.byIndex[5]).toBeNull();
    expect(matchMeasures(ann, ["a", "x", "y", "z"]).mode).toBe("order"); // one hit of four is a coincidence, not a match
    expect(matchMeasures(ann, []).mode).toBe("order");
  });
});
