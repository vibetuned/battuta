/**
 * Lyrics: one verse of syllables inside notes — set/replace/clear with
 * byte-identical revert, word-position attributes as given, chords
 * anchoring on their first note, rests refused.
 */
import { describe, it, expect } from "vitest";
import { buildEventIndex, serialize, SetSylCommand, sylAt, type CommandContext } from "../src/index.js";
import { scoreFrom, mei } from "./helpers.js";

const BODY = `
  <measure n="1" xml:id="m1">
    <staff n="1"><layer n="1"><note pname="c" oct="4" dur="4" xml:id="n1"/><note pname="d" oct="4" dur="4" xml:id="n2"/><rest dur="2" xml:id="r1"/></layer></staff>
    <staff n="2"><layer n="1"><chord dur="1" xml:id="ch1"><note pname="c" oct="3" xml:id="ch1a"/><note pname="e" oct="3" xml:id="ch1b"/></chord></layer></staff>
  </measure>`;

function setup() {
  const { score } = scoreFrom(mei(BODY));
  const ctx: CommandContext = { score, index: buildEventIndex(score) };
  const snapshot = () => serialize(score.measures[0]!);
  return { score, ctx, snapshot };
}

describe("SetSylCommand", () => {
  it("sets a syllable and unwinds byte-identically", () => {
    const { ctx, snapshot, score } = setup();
    const before = snapshot();
    const cmd = new SetSylCommand("n1", { text: "hel", wordpos: "i", con: "d" });
    cmd.apply(ctx);
    const out = snapshot();
    expect(out).toContain('<verse');
    expect(out).toContain('wordpos="i"');
    expect(out).toContain('con="d"');
    expect(out).toContain(">hel</syl>");
    expect(sylAt(score.measures[0]!, "n1")).toEqual({ text: "hel", wordpos: "i", con: "d" });
    cmd.revert(ctx);
    expect(snapshot()).toBe(before);
  });

  it("replaces an existing syllable and clears with empty text", () => {
    const { ctx, snapshot, score } = setup();
    new SetSylCommand("n1", { text: "la" }).apply(ctx);
    const withLa = snapshot();
    const replace = new SetSylCommand("n1", { text: "lo", wordpos: "t" });
    replace.apply(ctx);
    expect(sylAt(score.measures[0]!, "n1")).toEqual({ text: "lo", wordpos: "t" });
    replace.revert(ctx);
    expect(snapshot()).toBe(withLa);
    new SetSylCommand("n1", { text: "" }).apply(ctx);
    expect(sylAt(score.measures[0]!, "n1")).toBe(null);
    expect(snapshot()).not.toContain("<verse");
  });

  it("a chord carries the verse on its FIRST note", () => {
    const { ctx, score } = setup();
    new SetSylCommand("ch1", { text: "word" }).apply(ctx);
    const m = serialize(score.measures[0]!);
    const firstNote = m.indexOf('xml:id="ch1a"');
    const verse = m.indexOf("<verse");
    const secondNote = m.indexOf('xml:id="ch1b"');
    expect(verse).toBeGreaterThan(firstNote);
    expect(verse).toBeLessThan(secondNote);
    expect(sylAt(score.measures[0]!, "ch1")).toEqual({ text: "word" });
  });

  it("refuses rests", () => {
    const { ctx } = setup();
    expect(() => new SetSylCommand("r1", { text: "x" }).apply(ctx)).toThrow(/note or chord/);
  });

  it("clearing a note without lyrics is a clean no-op", () => {
    const { ctx, snapshot } = setup();
    const before = snapshot();
    const cmd = new SetSylCommand("n2", { text: "" });
    expect(cmd.apply(ctx)).toEqual([{ measureIndex: 0, staffN: 1 }]);
    expect(snapshot()).toBe(before);
    cmd.revert(ctx);
    expect(snapshot()).toBe(before);
  });
});
