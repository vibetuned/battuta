import { describe, it, expect } from "vitest";
import { synthesizeTile, synthesizeScoreDef, synthesizeRowHeader, serialize, buildEventIndex, ToggleSlurCommand, ChainTieCommand } from "../src/index.js";
import { scoreFrom, mei, measure } from "./helpers.js";

describe("synthesizeTile", () => {
  it("carries the effective context of the window's first measure", () => {
    const { score, contexts } = scoreFrom(mei(`${measure(1)} <scoreDef keysig="3s"/> ${measure(2)} <staffDef n="2" clef.shape="C" clef.line="4"/> ${measure(3)}`));
    const t1 = synthesizeTile(score, contexts, 0);
    expect(t1.xml).toContain(`keysig="0"`);
    const t2 = synthesizeTile(score, contexts, 1);
    expect(t2.xml).toContain(`keysig="3s"`);
    expect(t2.xml).not.toContain(`keysig="0"`);
    const t3 = synthesizeTile(score, contexts, 2);
    expect(t3.xml).toContain(`clef.shape="C"`);
  });

  it("strips labels and header/footer elements from the tile scoreDef", () => {
    const { score, contexts } = scoreFrom(mei(measure(1)));
    const tile = synthesizeTile(score, contexts, 0);
    expect(tile.xml).not.toContain("<label");
    expect(serialize(score.scoreDef)).toContain("<label"); // original untouched
  });

  it("keeps the staffGrp skeleton (braces/brackets)", () => {
    const { score, contexts } = scoreFrom(mei(measure(1)));
    const def = synthesizeScoreDef(score, contexts[0]!);
    expect(serialize(def)).toContain(`symbol="brace"`);
  });

  it("includes the requested measure window verbatim, ids intact", () => {
    const { score, contexts } = scoreFrom(mei(`${measure(1)} ${measure(2)} ${measure(3)}`));
    const tile = synthesizeTile(score, contexts, 1, 2);
    expect(tile.measureIds).toEqual(["m2", "m3"]);
    expect(tile.xml).toContain(`xml:id="m2"`);
    expect(tile.xml).toContain(`xml:id="m3"`);
    expect(tile.xml).not.toContain(`xml:id="m1"`);
  });

  it("cache key changes when context changes but content does not", () => {
    const body = `${measure(1)} <scoreDef keysig="3s"/> ${measure(2)}`;
    const { score, contexts } = scoreFrom(mei(body));
    // Same measure content (modulo ids), different effective context.
    const k1 = synthesizeTile(score, contexts, 0).key.split("-")[0];
    const k2 = synthesizeTile(score, contexts, 1).key.split("-")[0];
    expect(k1).not.toBe(k2);
  });

  it("cache key is stable across repeated synthesis", () => {
    const { score, contexts } = scoreFrom(mei(measure(1)));
    expect(synthesizeTile(score, contexts, 0).key).toBe(synthesizeTile(score, contexts, 0).key);
  });

  it("bare header hides clef/keysig/meter/brackets but keeps their values in force", () => {
    const { score, contexts } = scoreFrom(mei(measure(1), `meter.count="3" meter.unit="4" keysig="2s"`));
    const bare = synthesizeTile(score, contexts, 0, 1, "bare");
    expect(bare.xml).toContain(`keysig="2s"`); // value stays for pitch spelling
    expect(bare.xml).toContain(`clef.shape="G"`); // value stays for staff positions
    expect(bare.xml).toContain(`clef.visible="false"`);
    expect(bare.xml).toContain(`keysig.visible="false"`);
    expect(bare.xml).toContain(`meter.form="invis"`);
    expect(bare.xml).toContain(`system.leftline="false"`);
    expect(bare.xml).not.toContain(`symbol="brace"`);
    const full = synthesizeTile(score, contexts, 0, 1, "full");
    expect(full.xml).toContain(`symbol="brace"`);
    expect(full.xml).not.toContain("keysig.visible");
    expect(full.xml).not.toContain("clef.visible");
    expect(full.key).not.toBe(bare.key); // variants cache separately
    const clefOnly = synthesizeTile(score, contexts, 0, 1, { clef: true, keysig: false, meter: false, symbols: false });
    expect(clefOnly.xml).not.toContain("clef.visible");
    expect(clefOnly.xml).toContain(`keysig.visible="false"`);
  });
});

describe("synthesizeRowHeader", () => {
  it("emits clef+keysig+symbols over one invisible measure, keyed by context", () => {
    const { score, contexts } = scoreFrom(mei(`${measure(1)} <scoreDef keysig="3s"/> ${measure(2)}`));
    const h0 = synthesizeRowHeader(score, contexts, 0);
    expect(h0.xml).toContain(`symbol="brace"`);
    expect(h0.xml).toContain(`meter.form="invis"`);
    expect(h0.xml).not.toContain("keysig.visible");
    expect(h0.xml).toContain(`right="invis"`);
    expect(h0.xml).toContain("<mSpace/>");
    const h1 = synthesizeRowHeader(score, contexts, 1);
    expect(h1.xml).toContain(`keysig="3s"`);
    expect(h1.key).not.toBe(h0.key); // context change -> different header
    expect(synthesizeRowHeader(score, contexts, 0).key).toBe(h0.key); // stable
  });
});

describe("control-event segmentation at tile boundaries", () => {
  const twoMeasuresWithSlur = `
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="e" oct="5" dur="1" xml:id="n1"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="n1b"/></layer></staff>
      <slur startid="#n1" endid="#n2"/>
      <tie startid="#n1b" endid="#n2b"/>
    </measure>
    <measure n="2" xml:id="m2">
      <staff n="1"><layer n="1"><note pname="d" oct="5" dur="1" xml:id="n2"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="n2b"/></layer></staff>
      <dir startid="#n1">dolce</dir>
    </measure>`;

  it("keeps curves intact when both anchors are inside the window", () => {
    const { score, contexts } = scoreFrom(mei(twoMeasuresWithSlur));
    const tile = synthesizeTile(score, contexts, 0, 2);
    expect(tile.xml).toContain(`startid="#n1"`);
    expect(tile.xml).toContain(`endid="#n2"`);
    expect(tile.xml).not.toContain("tstamp");
  });

  it("rewrites an outgoing curve as a tstamp2 stub", () => {
    const { score, contexts } = scoreFrom(mei(twoMeasuresWithSlur));
    const tile = synthesizeTile(score, contexts, 0, 1);
    expect(tile.xml).toContain(`startid="#n1"`);
    expect(tile.xml).not.toContain(`endid="#n2"`);
    expect(tile.xml).toContain(`tstamp2="0m+5"`); // 4/4 -> just past beat 4
    expect(tile.xml).toMatch(/<slur[^>]*staff="1"/);
    expect(tile.xml).toMatch(/<tie[^>]*staff="2"/); // staff inferred per event
  });

  it("drops point events whose anchor is outside the window", () => {
    const { score, contexts } = scoreFrom(mei(twoMeasuresWithSlur));
    const tile = synthesizeTile(score, contexts, 1, 1);
    expect(tile.xml).not.toContain("dolce"); // dir anchored to n1 (previous measure)
  });

  it("injects incoming continuation stubs for curves starting before the window", () => {
    const { score, contexts } = scoreFrom(mei(twoMeasuresWithSlur));
    const tile = synthesizeTile(score, contexts, 1, 1);
    // The slur/tie elements live in m1, yet tile m2 must show their arrival.
    expect(tile.xml).toMatch(/<slur[^>]*tstamp="0"[^>]*endid="#n2"|<slur[^>]*endid="#n2"[^>]*tstamp="0"/);
    expect(tile.xml).toMatch(/<tie[^>]*endid="#n2b"/);
    expect(tile.xml).not.toContain("startid"); // no dangling references remain
  });

  it("does not mutate the original score when segmenting", () => {
    const { score, contexts } = scoreFrom(mei(twoMeasuresWithSlur));
    synthesizeTile(score, contexts, 0, 1);
    const again = synthesizeTile(score, contexts, 0, 2);
    expect(again.xml).toContain(`endid="#n2"`); // original slur still whole
  });
});

describe("span segmentation after edits", () => {
  it("a slur added by command reaches the end tile (span index must not go stale)", () => {
    const { score, contexts } = scoreFrom(mei(`${measure(1)} ${measure(2)} ${measure(3)}`));
    // Warm the span-end index with a render of the future end tile.
    const endBefore = synthesizeTile(score, contexts, 2);
    expect(endBefore.xml).not.toContain("<slur");
    const cmd = new ToggleSlurCommand("m1s1n1", "m3s1n1");
    cmd.apply({ score, index: buildEventIndex(score) });
    const start = synthesizeTile(score, contexts, 0);
    const middle = synthesizeTile(score, contexts, 1);
    const end = synthesizeTile(score, contexts, 2);
    // start: outgoing stub — endid dropped, tstamp2 to the slice edge
    expect(start.xml).toContain("<slur");
    expect(start.xml).toContain('tstamp2=');
    expect(start.xml).not.toContain('endid="#m3s1n1"');
    // middle: the curve passes entirely over -> not drawn (accepted)
    expect(middle.xml).not.toContain("<slur");
    // end: injected incoming stub — tstamp-anchored, no duplicate id
    expect(end.xml).toContain("<slur");
    expect(end.xml).toContain('tstamp="0"');
    expect(end.xml).not.toContain('startid=');
    expect(end.key).not.toBe(endBefore.key); // cache key must change too
    // undo: stub disappears again (index invalidated on revert as well)
    cmd.revert({ score, index: buildEventIndex(score) });
    const endAfter = synthesizeTile(score, contexts, 2);
    expect(endAfter.xml).not.toContain("<slur");
    expect(endAfter.key).toBe(endBefore.key);
  });
});

describe("edge tie stubs", () => {
  it("attribute ties crossing the tile edge get explicit <tie> stubs both sides", () => {
    const body = `
      <measure n="1" xml:id="m1">
        <staff n="1"><layer n="1"><note pname="c" oct="4" dur="1" xml:id="t1"/></layer></staff>
        <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="u1"/></layer></staff>
      </measure>
      <measure n="2" xml:id="m2">
        <staff n="1"><layer n="1"><note pname="c" oct="4" dur="1" xml:id="t2"/></layer></staff>
        <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="u2"/></layer></staff>
      </measure>`;
    const { score, contexts } = scoreFrom(mei(body));
    new ChainTieCommand(["t1", "t2"]).apply({ score, index: buildEventIndex(score) });
    const start = synthesizeTile(score, contexts, 0);
    expect(start.xml).toContain('<tie startid="#t1" tstamp2="0m+5" staff="1"');
    const end = synthesizeTile(score, contexts, 1);
    expect(end.xml).toContain('<tie endid="#t2" tstamp="0" staff="1"');
    // untouched staff 2 gets no stubs
    expect(start.xml).not.toContain('staff="2"/>');
    // interior pairs in a wider slice match by themselves — no stubs inside
    const both = synthesizeTile(score, contexts, 0, 2);
    expect(both.xml).not.toContain("<tie ");
  });
});
