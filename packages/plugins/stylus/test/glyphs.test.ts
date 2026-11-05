/**
 * The engraved symbols: every class the plugin writes has one — Noto Music's
 * glyph, a digit, a word, or a drawing — and the bows too; the glyphs are the
 * right ones; an unknown label shows its name.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { DRAWN, Glyph, glyphTextOf } from "../src/glyphs";
import { CLASS_LABELS } from "../src/rules";

describe("the engraved symbols", () => {
  it("every class, and the two bows, has a glyph or a drawing", () => {
    expect(CLASS_LABELS.length).toBe(43);
    for (const label of [...CLASS_LABELS, "tie", "slur"]) expect(glyphTextOf(label) !== null || DRAWN.includes(label), label).toBe(true);
  });

  it("the glyphs are the engraved ones: the sharp, the quarter note, a note wearing its staccato, a dotted note for the dot, sfz from its letters, a digit, a word", () => {
    expect(glyphTextOf("accidentalSharp")).toBe("\u266F");
    expect(glyphTextOf("noteQuarter")).toBe("\u{1D15F}");
    expect(glyphTextOf("restQuarter")).toBe("\u{1D13D}");
    expect(glyphTextOf("articStaccatoAbove")).toBe("\u{1D15F}\u{1D17C}");
    expect(glyphTextOf("augmentationDot")).toBe("\u{1D15F}\u{1D16D}");
    expect(glyphTextOf("dynamicSforzando")).toBe("\u{1D18D}\u{1D191}\u{1D18E}");
    expect(glyphTextOf("dynamicMF")).toBe("\u{1D190}\u{1D191}");
    expect(glyphTextOf("fing3")).toBe("3");
    expect(glyphTextOf("dalSegno")).toBe("D.S.");
    expect(glyphTextOf("mordent")).toBeNull();
  });

  it("the element names its class; a drawing is an svg; an unknown label shows its name", () => {
    const sharp = Glyph({ label: "accidentalSharp" }) as ReactElement<{ "data-stylus-glyph": string; children: string }>;
    expect(sharp.props["data-stylus-glyph"]).toBe("accidentalSharp");
    expect(sharp.props.children).toBe("\u266F");
    expect((Glyph({ label: "tie" }) as ReactElement).type).toBe("svg");
    expect((Glyph({ label: "whatever" }) as ReactElement<{ children: string }>).props.children).toBe("whatever");
  });
});
