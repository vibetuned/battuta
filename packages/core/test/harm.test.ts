import { describe, it, expect } from "vitest";
// Core owns the ELEMENT and its VALIDITY: the grammars below decide what
// text may be written into a <harm> at all, and SetHarmCommand refuses on
// them — below every writer, so the harmony lane and any future generator
// are refused the same junk (the api asks the same grammar as
// ctx.query.harmValid). The editor affordances — charsets, the numeral key
// mapping, the suggestion lists — are the harmony plugin's, with their
// tests (packages/plugins/harmony/test/grammar.test.ts).
import { buildEventIndex, serialize, findAll, SetHarmCommand, harmTextAt, isChordSymbol, isRomanNumeral, isHarmText, type CommandContext } from "../src/index.js";
import { scoreFrom, mei } from "./helpers.js";

const ctxFor = (score: ReturnType<typeof scoreFrom>["score"]): CommandContext => ({ score, index: buildEventIndex(score) });

describe("harmony validity", () => {
  it("accepts the chord-symbol families", () => {
    for (const good of ["C", "Cm", "C7", "Cmaj7", "CM7", "CΔ7", "Cm7", "C-7", "Cdim", "C°7", "Cm7b5", "Cø7", "Caug", "C+", "Csus4", "Csus2", "Cadd9", "C6", "Cm6", "C9", "C11", "C13", "Cmaj9", "C7b9", "C7#9", "C7alt", "F#m7", "Bb13", "C/E", "G/B", "F#m7/A"]) {
      expect(isChordSymbol(good), good).toBe(true);
    }
    for (const bad of ["H", "Cx", "C/", "/E", "Cmaj7b", "Csus3", "C##", "cm"]) {
      expect(isChordSymbol(bad), bad).toBe(false);
    }
  });

  it("accepts the roman-numeral families", () => {
    for (const good of ["I", "i", "IV", "vii°", "vii°7", "viiø7", "III+", "V7", "V65", "V43", "V42", "V2", "I6", "I64", "ii7", "bVI", "bIII", "#iv", "N6", "N", "It+6", "Fr+6", "Ger+6", "V/V", "V7/IV", "vii°7/vi", "bII6"]) {
      expect(isRomanNumeral(good), good).toBe(true);
    }
    for (const bad of ["VIII", "Iv", "V99", "x", "V/", "/V", "It7", "N64"]) {
      expect(isRomanNumeral(bad), bad).toBe(false);
    }
  });

  it("isHarmText picks the grammar by kind — what the api answers as harmValid", () => {
    expect(isHarmText("chord", "Cmaj7")).toBe(true);
    expect(isHarmText("chord", "V65")).toBe(false);
    expect(isHarmText("rna", "V65")).toBe(true);
    expect(isHarmText("rna", "Cmaj7")).toBe(false);
  });
});

describe("SetHarmCommand", () => {
  const body = `
    <measure n="1" xml:id="m1">
      <staff n="1"><layer n="1"><note pname="c" oct="4" dur="2" xml:id="h1"/><note pname="g" oct="4" dur="2" xml:id="h2"/></layer></staff>
      <staff n="2"><layer n="1"><mRest/></layer></staff>
    </measure>`;

  it("creates, replaces, and clears both kinds independently", () => {
    const { score } = scoreFrom(mei(body));
    const before = serialize(score.scoreEl);
    new SetHarmCommand("h1", "Cmaj7", "chord").apply(ctxFor(score));
    new SetHarmCommand("h1", "I64", "rna").apply(ctxFor(score));
    const harms = findAll(score.measures[0]!, "harm");
    expect(harms).toHaveLength(2);
    expect(harms.find((h) => h.attrs["type"] === "rna")!.attrs["place"]).toBe("below");
    expect(harms.find((h) => h.attrs["type"] !== "rna")!.attrs["place"]).toBe("above");
    expect(harmTextAt(score.measures[0]!, "h1", "chord")).toBe("Cmaj7");
    expect(harmTextAt(score.measures[0]!, "h1", "rna")).toBe("I64");
    new SetHarmCommand("h1", "C/E", "chord").apply(ctxFor(score)); // replace
    expect(harmTextAt(score.measures[0]!, "h1", "chord")).toBe("C/E");
    expect(harmTextAt(score.measures[0]!, "h1", "rna")).toBe("I64"); // untouched
    new SetHarmCommand("h1", "", "chord").apply(ctxFor(score)); // clear
    new SetHarmCommand("h1", "", "rna").apply(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(before);
  });

  it("rejects invalid text, reverts byte-identically, clearing nothing is a no-op", () => {
    const { score } = scoreFrom(mei(body));
    expect(() => new SetHarmCommand("h1", "H7", "chord").apply(ctxFor(score))).toThrow(/not a valid/);
    expect(() => new SetHarmCommand("h1", "V99", "rna").apply(ctxFor(score))).toThrow(/not a valid/);
    const before = serialize(score.scoreEl);
    new SetHarmCommand("h2", "", "chord").apply(ctxFor(score)); // clear nothing
    expect(serialize(score.scoreEl)).toBe(before);
    const cmd = new SetHarmCommand("h2", "V7/IV", "rna");
    cmd.apply(ctxFor(score));
    cmd.revert(ctxFor(score));
    expect(serialize(score.scoreEl)).toBe(before);
  });
});
