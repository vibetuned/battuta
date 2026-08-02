import { describe, it, expect } from "vitest";
import { synthesizeTile, synthesizeScoreDef, serialize } from "../src/index.js";
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
