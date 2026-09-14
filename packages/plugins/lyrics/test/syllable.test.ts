/**
 * The wordpos/con table — the only thing lyrics knows, as a table.
 *
 * MEI splits a word across notes with `wordpos` i/m/t and `con="d"` on
 * every syllable that hyphenates into the next. These cases are what
 * 0.0.3 wrote, kept verbatim through the extraction: the browser script
 * (`spikes/verify-lyrics.mjs`) types the same word and reads the same
 * attributes back out of the saved MEI.
 */
import { describe, it, expect } from "vitest";
import { syllableCommit, type Syllable } from "../src/syllable";

const hyphenated = (text: string, wordpos: string): Syllable => ({ text, wordpos, con: "d" });
const commit = (buffer: string, key: string, existing: Syllable | null = null, previous: Syllable | null = null) => syllableCommit({ buffer, key, existing, previous });

describe("a word spread over notes", () => {
  it('"hel" + "-" opens the word: wordpos i, con d', () => {
    expect(commit("hel", "-")).toEqual(hyphenated("hel", "i"));
  });

  it('a middle syllable after a continuation: wordpos m, con d ("hy-phen-ate")', () => {
    expect(commit("phen", "-", null, hyphenated("hy", "i"))).toEqual(hyphenated("phen", "m"));
  });

  it('"lo" + space after a continuation closes the word: wordpos t, no con', () => {
    expect(commit("lo", " ", null, hyphenated("hel", "i"))).toEqual({ text: "lo", wordpos: "t" });
  });

  it("a whole word on one note carries neither attribute", () => {
    expect(commit("world", "Enter")).toEqual({ text: "world" });
    expect(commit("world", " ", null, { text: "lo", wordpos: "t" })).toEqual({ text: "world" });
  });

  it("the PREVIOUS syllable decides mid-word, not this one's text", () => {
    // Same buffer, same key: only the previous note's `con` differs.
    expect(commit("a", "Enter", null, { text: "x" })).toEqual({ text: "a" });
    expect(commit("a", "Enter", null, hyphenated("x", "i"))).toEqual({ text: "a", wordpos: "t" });
  });
});

describe("what writes nothing at all", () => {
  // Every one of these is the caret crossing a syllable: Escape, an arrow,
  // an advance over a note that already reads what the buffer says. None
  // may cost an undo step.
  it("an unchanged syllable, committed by any key that is not a hyphen", () => {
    const hel: Syllable = { text: "hel" };
    for (const key of ["Escape", "Enter", " ", "ArrowLeft", "ArrowRight"]) expect(commit("hel", key, hel), key).toBeNull();
  });

  it("an unchanged HYPHENATED syllable keeps its hyphen — the 0.0.3 bug slice 5a fixed", () => {
    const hel = hyphenated("hel", "i");
    expect(commit("hel", "Escape", hel)).toBeNull();
    expect(commit("hel", "ArrowRight", hel)).toBeNull();
    // …and typing over it does drop the hyphen, because the text changed.
    expect(commit("help", "Escape", hel)).toEqual({ text: "help" });
  });

  it("an empty buffer on a note that has nothing", () => {
    expect(commit("", "Enter")).toBeNull();
    expect(commit("", "Escape")).toBeNull();
  });
});

describe("clearing and re-hyphenating", () => {
  it("an empty buffer over an existing syllable clears it", () => {
    expect(commit("", "Enter", { text: "lo", wordpos: "t" })).toEqual({ text: "" });
  });

  it("`-` hyphenates a syllable that was not hyphenated", () => {
    expect(commit("hel", "-", { text: "hel" })).toEqual(hyphenated("hel", "i"));
  });

  it("a non-hyphen key un-hyphenates only when the text changed", () => {
    expect(commit("hel", " ", hyphenated("hel", "i"))).toBeNull();
    expect(commit("hell", " ", hyphenated("hel", "i"))).toEqual({ text: "hell" });
  });
});
