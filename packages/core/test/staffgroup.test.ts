/**
 * Staff-group cycle: none → brace → bracket → none over a staff range,
 * wrapping/unwrapping nested <staffGrp>s (or restyling an exact match,
 * the scoreDef's root group included), refusing ranges that would cross
 * an existing group, and reverting byte-identically.
 */
import { describe, it, expect } from "vitest";
import { buildEventIndex, serialize, CycleStaffGroupCommand, type CommandContext } from "../src/index.js";
import { scoreFrom } from "./helpers.js";

const trio = (grpBody: string) => `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
  <music><body><mdiv><score>
    <scoreDef meter.count="4" meter.unit="4">
      <staffGrp>${grpBody}</staffGrp>
    </scoreDef>
    <section><measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="c" oct="5" dur="1" xml:id="a1"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="4" dur="1" xml:id="a2"/></layer></staff>
      <staff n="3"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="a3"/></layer></staff>
    </measure></section>
  </score></mdiv></body></music>
</mei>`;

const DEFS = `<staffDef n="1" lines="5" clef.shape="G" clef.line="2"/><staffDef n="2" lines="5" clef.shape="G" clef.line="2"/><staffDef n="3" lines="5" clef.shape="F" clef.line="4"/>`;

function setup(grpBody = DEFS) {
  const { score } = scoreFrom(trio(grpBody));
  const ctx: CommandContext = { score, index: buildEventIndex(score) };
  return { score, ctx, snapshot: () => serialize(score.scoreDef) };
}

describe("CycleStaffGroupCommand", () => {
  it("wraps adjacent staves in a brace group, then bracket, then unwraps", () => {
    const { ctx, snapshot } = setup();
    const original = snapshot();

    const wrap = new CycleStaffGroupCommand(1, 2);
    wrap.apply(ctx);
    expect(wrap.result).toBe("brace");
    const braced = snapshot();
    expect(braced).toMatch(/<staffGrp[^>]*symbol="brace"[^>]*bar\.thru="true"/);

    const toBracket = new CycleStaffGroupCommand(1, 2);
    toBracket.apply(ctx);
    expect(toBracket.result).toBe("bracket");
    expect(snapshot()).toContain('symbol="bracket"');

    const off = new CycleStaffGroupCommand(1, 2);
    off.apply(ctx);
    expect(off.result).toBe("none");
    expect(snapshot()).not.toContain("symbol=");
    // the wrapper is GONE, and staff order survived the round trip
    expect((snapshot().match(/<staffGrp/g) ?? []).length).toBe(1);
    expect(snapshot().indexOf('n="1"')).toBeLessThan(snapshot().indexOf('n="2"'));

    // unwind the whole cycle byte-identically
    off.revert(ctx);
    expect(snapshot()).toContain('symbol="bracket"');
    toBracket.revert(ctx);
    expect(snapshot()).toBe(braced);
    wrap.revert(ctx);
    expect(snapshot()).toBe(original);
  });

  it("the FULL range matches the scoreDef's root group: restyle, never unwrap", () => {
    const { ctx, snapshot } = setup();
    const cmd = new CycleStaffGroupCommand(1, 3);
    cmd.apply(ctx);
    expect(cmd.result).toBe("brace");
    expect((snapshot().match(/<staffGrp/g) ?? []).length).toBe(1); // still just the root
    new CycleStaffGroupCommand(1, 3).apply(ctx);
    const off = new CycleStaffGroupCommand(1, 3);
    off.apply(ctx);
    expect(off.result).toBe("none");
    expect((snapshot().match(/<staffGrp/g) ?? []).length).toBe(1); // root group survives
    expect(snapshot()).not.toContain("symbol=");
  });

  it("refuses a range that would cross an existing group", () => {
    const { ctx } = setup();
    new CycleStaffGroupCommand(1, 2).apply(ctx); // {1,2} grouped
    expect(() => new CycleStaffGroupCommand(2, 3).apply(ctx)).toThrow(/cross an existing staff group/);
  });

  it("refuses unknown staves", () => {
    const { ctx } = setup();
    expect(() => new CycleStaffGroupCommand(3, 4).apply(ctx)).toThrow(/no staff 4/);
  });

  it("dirties the grouped staves across every measure (barlines change)", () => {
    const { ctx } = setup();
    const dirty = new CycleStaffGroupCommand(1, 2).apply(ctx);
    expect(dirty).toEqual([
      { measureIndex: 0, staffN: 1 },
      { measureIndex: 0, staffN: 2 },
    ]);
  });
});
