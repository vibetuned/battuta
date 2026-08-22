import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { contextHash } from "../src/index.js";
import { scoreFrom, mei, measure } from "./helpers.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

describe("resolveContexts — initial state", () => {
  it("reads clefs, key, meter from the initial scoreDef (attribute form)", () => {
    const { contexts } = scoreFrom(mei(measure(1), `meter.count="3" meter.unit="4" keysig="2s"`));
    const m0 = contexts[0]!;
    expect(m0.get(1)!.clef).toEqual({ shape: "G", line: 2 });
    expect(m0.get(2)!.clef).toEqual({ shape: "F", line: 4 });
    expect(m0.get(1)!.keysig).toBe("2s");
    expect(m0.get(2)!.keysig).toBe("2s");
    expect(m0.get(1)!.meter).toEqual({ count: "3", unit: "4" });
    expect(m0.get(1)!.lines).toBe(5);
  });

  it("reads child-element form (<clef>, <keySig>, <meterSig>)", () => {
    const xml = `<?xml version="1.0"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
  <music><body><mdiv><score>
    <scoreDef>
      <staffGrp>
        <staffDef n="1" lines="5">
          <clef shape="C" line="3"/>
          <keySig sig="1f"/>
          <meterSig count="6" unit="8"/>
        </staffDef>
      </staffGrp>
    </scoreDef>
    <section>${measure(1)}</section>
  </score></mdiv></body></music></mei>`;
    const { contexts } = scoreFrom(xml);
    const s1 = contexts[0]!.get(1)!;
    expect(s1.clef).toEqual({ shape: "C", line: 3 });
    expect(s1.keysig).toBe("1f");
    expect(s1.meter).toEqual({ count: "6", unit: "8" });
  });

  it("supports MEI 4 key.sig spelling and octave-displaced clefs", () => {
    const xml = `<?xml version="1.0"?>
<mei xmlns="http://www.music-encoding.org/ns/mei">
  <music><body><mdiv><score>
    <scoreDef key.sig="3f">
      <staffGrp>
        <staffDef n="1" lines="5" clef.shape="G" clef.line="2" clef.dis="8" clef.dis.place="below"/>
      </staffGrp>
    </scoreDef>
    <section>${measure(1)}</section>
  </score></mdiv></body></music></mei>`;
    const { contexts } = scoreFrom(xml);
    const s1 = contexts[0]!.get(1)!;
    expect(s1.keysig).toBe("3f");
    expect(s1.clef).toEqual({ shape: "G", line: 2, dis: 8, disPlace: "below" });
  });

  it("keeps transposition attributes (transposing staves)", () => {
    const xml = `<?xml version="1.0"?>
<mei xmlns="http://www.music-encoding.org/ns/mei">
  <music><body><mdiv><score>
    <scoreDef>
      <staffGrp>
        <staffDef n="1" lines="5" clef.shape="G" clef.line="2" trans.semi="-2" trans.diat="-1"/>
      </staffGrp>
    </scoreDef>
    <section>${measure(1)}</section>
  </score></mdiv></body></music></mei>`;
    const { contexts } = scoreFrom(xml);
    expect(contexts[0]!.get(1)!.transSemi).toBe(-2);
    expect(contexts[0]!.get(1)!.transDiat).toBe(-1);
  });
});

describe("resolveContexts — mid-piece changes", () => {
  it("applies an interleaved scoreDef key change to all staves, from that measure on", () => {
    const { contexts } = scoreFrom(mei(`${measure(1)} <scoreDef keysig="3s"/> ${measure(2)} ${measure(3)}`));
    expect(contexts[0]!.get(1)!.keysig).toBe("0");
    expect(contexts[0]!.get(2)!.keysig).toBe("0");
    expect(contexts[1]!.get(1)!.keysig).toBe("3s");
    expect(contexts[1]!.get(2)!.keysig).toBe("3s");
    expect(contexts[2]!.get(1)!.keysig).toBe("3s");
  });

  it("applies an interleaved staffDef clef change to that staff only", () => {
    const { contexts } = scoreFrom(mei(`${measure(1)} <staffDef n="2" clef.shape="C" clef.line="4"/> ${measure(2)}`));
    expect(contexts[1]!.get(2)!.clef).toEqual({ shape: "C", line: 4 });
    expect(contexts[1]!.get(1)!.clef).toEqual({ shape: "G", line: 2 }); // untouched
    expect(contexts[1]!.get(2)!.keysig).toBe("0"); // staffDef change keeps other context
  });

  it("applies a meter change from an interleaved scoreDef", () => {
    const { contexts } = scoreFrom(mei(`${measure(1)} <scoreDef meter.count="6" meter.unit="8"/> ${measure(2)}`));
    expect(contexts[0]!.get(1)!.meter).toEqual({ count: "4", unit: "4" });
    expect(contexts[1]!.get(1)!.meter).toEqual({ count: "6", unit: "8" });
    expect(contexts[1]!.get(2)!.meter).toEqual({ count: "6", unit: "8" });
  });

  it("inline <clef> inside a measure changes FOLLOWING measures only", () => {
    const withClef = `<measure n="2" xml:id="m2">
      <staff n="1"><layer n="1"><note pname="d" oct="4" dur="2"/><clef shape="F" line="4"/><note pname="e" oct="3" dur="2"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1"/></layer></staff>
    </measure>`;
    const { contexts } = scoreFrom(mei(`${measure(1)} ${withClef} ${measure(3)}`));
    expect(contexts[1]!.get(1)!.clef).toEqual({ shape: "G", line: 2 }); // clef change renders inside m2
    expect(contexts[2]!.get(1)!.clef).toEqual({ shape: "F", line: 4 }); // m3 sees the new clef
    expect(contexts[2]!.get(2)!.clef).toEqual({ shape: "F", line: 4 }); // staff 2 had F4 all along
  });

  it("last of several inline clefs wins", () => {
    const withClefs = `<measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><clef shape="C" line="3"/><note pname="d" oct="4" dur="2"/><clef shape="C" line="4"/><note pname="e" oct="4" dur="2"/></layer></staff>
      <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1"/></layer></staff>
    </measure>`;
    const { contexts } = scoreFrom(mei(`${withClefs} ${measure(2)}`));
    expect(contexts[1]!.get(1)!.clef).toEqual({ shape: "C", line: 4 });
  });
});

describe("contextHash", () => {
  it("is stable for equal contexts and differs across changes", () => {
    const { contexts } = scoreFrom(mei(`${measure(1)} ${measure(2)} <scoreDef keysig="3s"/> ${measure(3)}`));
    expect(contextHash(contexts[0]!)).toBe(contextHash(contexts[1]!));
    expect(contextHash(contexts[1]!)).not.toBe(contextHash(contexts[2]!));
  });
});

// The corpus lives outside the repo (only the synthetic dev fixture is
// tracked); machines without it — CI included — skip these, not fail.
describe.runIf(existsSync(join(fixtures, "Bach-JS_Ein_feste_Burg.mei")))("real corpus", () => {
  it("resolves the Bach chorale (incipit in header, mid-score scoreDef)", () => {
    const xml = readFileSync(join(fixtures, "Bach-JS_Ein_feste_Burg.mei"), "utf8");
    const { score, contexts } = scoreFrom(xml);
    expect(score.measures.length).toBe(14);
    expect(contexts.length).toBe(14);
    for (const ctx of contexts) {
      expect(ctx.get(1)!.clef.shape).toBe("G");
      expect(ctx.get(2)!.clef.shape).toBe("F");
    }
  });

  it("resolves the Beethoven quartet's first movement (multi-mdiv, inline clefs)", () => {
    const xml = readFileSync(join(fixtures, "Beethoven_StringQuartet_Op18_No1.mei"), "utf8");
    const { score, contexts } = scoreFrom(xml);
    expect(score.mdivCount).toBeGreaterThan(1);
    expect(score.measures.length).toBe(313);
    expect(contexts.length).toBe(313);
    // Cello (staff 4) starts in bass clef.
    expect(contexts[0]!.get(4)!.clef.shape).toBe("F");
  });

  it("resolves the transposing staves of the Beethoven Hymn", () => {
    const xml = readFileSync(join(fixtures, "Beethoven_Hymn_to_joy.mei"), "utf8");
    const { contexts } = scoreFrom(xml);
    const transposing = [...contexts[0]!.values()].filter((s) => s.transSemi !== undefined && s.transSemi !== 0);
    expect(transposing.length).toBeGreaterThan(0);
  });
});
