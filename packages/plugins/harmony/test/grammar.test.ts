/**
 * The editor affordances: what may be typed, what a key becomes, and what
 * is offered. What a complete symbol IS is core's grammar and is tested
 * there (`packages/core/test/harm.test.ts`); the plugin asks it through
 * `ctx.query.harmValid`, so `suggestions` takes the predicate as a
 * parameter and this file passes a deliberately SMALL fake — enough to
 * exercise the one rule that consults it (the slash continuation) and no
 * more. The real answer is exercised end to end in `harmony.test.ts`,
 * where the host answers `harmValid` from core.
 */
import { describe, it, expect } from "vitest";
import { CHARS, suggestions, transformRna, type Kind, type Valid } from "../src/grammar";

/** A stand-in for `ctx.query.harmValid`, narrow on purpose: complete heads the tests below rely on, nothing else. */
const valid: Valid = (kind, text) => (kind === "chord" ? /^[A-G][b#]?(?:m|7|maj7|m7)?$/.test(text) : /^(?:I|V7|V65|Ger\+6)$/.test(text));
const suggest = (kind: Kind, buffer: string) => suggestions(kind, buffer, valid);

describe("suggestions (moved from core, case for case; the continuation rule asks the injected validity)", () => {
  it("completes from a prefix", () => {
    expect(suggest("chord", "Cma")).toContain("Cmaj7");
    expect(suggest("chord", "")).toContain("C");
    expect(suggest("rna", "V6")).toContain("V65");
    expect(suggest("rna", "Ge")).toContain("Ger+6");
    expect(suggest("chord", "Cmaj7").every((s) => s.startsWith("Cmaj7"))).toBe(true);
  });

  it("never offers the buffer back, and caps a completion pool at six", () => {
    for (const [kind, buffer] of [["chord", "C"], ["rna", "V"], ["rna", "i"], ["rna", ""]] as const) {
      const out = suggest(kind, buffer);
      expect(out, `${kind} "${buffer}"`).not.toContain(buffer);
      expect(out.length, `${kind} "${buffer}"`).toBeLessThanOrEqual(6);
      for (const s of out) expect(s.startsWith(buffer), `${s} extends ${buffer}`).toBe(true);
    }
    // The one exception, inherited unchanged: with no root typed the chord
    // lane offers the seven roots rather than a pool, and returns early.
    expect(suggest("chord", "")).toHaveLength(7);
  });

  it("offers a slash continuation once the head is a complete symbol — and not before", () => {
    // The one rule that needs the grammar asks the predicate the plugin
    // gets from the api (`ctx.query.harmValid`); both kinds take the same shape.
    expect(suggest("chord", "C7")).toContain("C7/");
    expect(suggest("chord", "Cmaj7b")).not.toContain("Cmaj7b/"); // an incomplete head offers no continuation
    expect(suggest("rna", "V7")).toContain("V7/");
    const secondary = suggest("rna", "V/");
    expect(secondary).toContain("V/I");
    expect(secondary.every((s) => s.startsWith("V/"))).toBe(true);
    // …and a secondary head offers no augmented-sixth chords after it
    expect(secondary.some((s) => s.includes("+6"))).toBe(false);
  });

  it("a chord buffer with no root offers the roots", () => {
    expect(suggest("chord", "")).toEqual(["C", "D", "E", "F", "G", "A", "B"]);
    expect(suggest("chord", "B")).not.toEqual(["B"]); // a root typed: qualities now
  });
});

describe("charsets — what may extend a buffer at all", () => {
  const admits = (kind: Kind, text: string) => [...text].every((ch) => CHARS[kind].test(ch));

  it("chord symbols admit roots, accidentals, digits and quality letters", () => {
    for (const good of ["Cmaj7", "F#m7b5", "Bb13", "Cø7", "C°7", "CΔ7", "G/B", "C-7", "Caug", "Csus4"]) {
      expect(admits("chord", good), good).toBe(true);
    }
  });

  it("roman numerals admit numerals, figures and the borrowed-chord letters", () => {
    for (const good of ["V65", "vii°7", "viiø7", "bIII", "It+6", "Ger+6", "N6", "V7/IV", "#iv"]) {
      expect(admits("rna", good), good).toBe(true);
    }
  });

  it("each refuses the other's keys, which is what keeps a buffer typeable only as its own kind", () => {
    expect(CHARS.chord.test("v")).toBe(false); // lower-case numerals are the rna lane's
    expect(CHARS.rna.test("a")).toBe(false); // chord roots are the chord lane's
    expect(CHARS.chord.test("!")).toBe(false);
    expect(CHARS.rna.test("8")).toBe(false); // no figure uses 8 or 9
  });
});

describe("the numeral lane's key transform", () => {
  it("gives the two glyphs no keyboard has", () => {
    expect(transformRna("o")).toBe("°");
    expect(transformRna("0")).toBe("ø");
  });

  it("leaves everything else alone", () => {
    for (const ch of ["V", "i", "7", "/", "b", "#", "+", "°", "ø"]) expect(transformRna(ch), ch).toBe(ch);
  });

  it("…and what it produces is admitted by the charset it feeds", () => {
    // The transform runs BEFORE `accepts`, so a key it rewrites must land
    // inside the charset or the rewrite would silently drop the character.
    for (const ch of ["o", "0"]) expect(CHARS.rna.test(transformRna(ch)), ch).toBe(true);
  });
});
