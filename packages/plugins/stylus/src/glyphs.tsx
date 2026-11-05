/**
 * The symbols as engraved, for the label and the chooser (the user, 2026-11-02:
 * "replace the selection text by engraved symbols"). Most are Unicode's musical
 * symbols, drawn by Noto Music — the editor bundles its musical blocks
 * (U+2669–266F, U+1D100–1D1EA) behind the interface font, so a span naming that
 * family is enough. An articulation is a quarter note wearing it (the combining
 * marks need a base the font has; alone they are tofu), the augmentation dot a
 * dotted quarter, a dynamic its letters (𝆍𝆑𝆎), a fingering its digit, the words
 * — Fine, D.S., D.C. — bold italic as the score sets them. Unicode has no
 * mordent and no bow, so those three are drawn. Checked in the WebView on the
 * Galaxy Tab (2026-11-02). The name stays on the button's title and in the
 * notices (`nameOf`).
 */
import type { CSSProperties, ReactNode } from "react";
import { nameOf } from "./rules";

const NOTE = "\u{1D15F}";
const P = "\u{1D18F}", F = "\u{1D191}", M = "\u{1D190}", S = "\u{1D18D}", Z = "\u{1D18E}";

/** Noto Music's glyphs, by class. */
const TEXT: Record<string, string> = {
  accidentalFlat: "\u266D",
  accidentalNatural: "\u266E",
  accidentalSharp: "\u266F",
  noteWhole: "\u{1D15D}",
  noteHalf: "\u{1D15E}",
  noteQuarter: NOTE,
  note8th: "\u{1D160}",
  note16th: "\u{1D161}",
  augmentationDot: NOTE + "\u{1D16D}",
  restQuarter: "\u{1D13D}",
  gClef: "\u{1D11E}",
  fClef: "\u{1D122}",
  cClef: "\u{1D121}",
  fermata: "\u{1D110}",
  trill: "\u{1D196}",
  turn: "\u{1D197}",
  arpeg: "\u{1D183}",
  articStaccatoAbove: NOTE + "\u{1D17C}",
  articTenutoAbove: NOTE + "\u{1D17D}",
  articAccentAbove: NOTE + "\u{1D17B}",
  articStaccatissimoAbove: NOTE + "\u{1D17E}",
  articMarcatoAbove: NOTE + "\u{1D17F}",
  dynamicPiano: P,
  dynamicForte: F,
  dynamicSforzando: S + F + Z,
  dynamicPP: P + P,
  dynamicMP: M + P,
  dynamicMF: M + F,
  dynamicFF: F + F,
  dynamicFFF: F + F + F,
  dynamicForzando: F + Z,
  dynamicSforzato: S + F,
  coda: "\u{1D10C}",
  segno: "\u{1D10B}",
};

/** The fingerings: a digit, as engraved. */
const DIGITS: Record<string, string> = { fing1: "1", fing2: "2", fing3: "3", fing4: "4", fing5: "5" };

/** The words, bold italic. */
const WORDS: Record<string, string> = { fine: "Fine", dalSegno: "D.S.", daCapo: "D.C." };

/** What is drawn, Unicode having no glyph for it. */
export const DRAWN: readonly string[] = ["mordent", "tie", "slur"];

/** The text a class shows, when it is text: Noto Music's glyph, a digit, a word; null for a drawing or an unknown class. */
export const glyphTextOf = (label: string): string | null => TEXT[label] ?? DIGITS[label] ?? WORDS[label] ?? null;

const MUSIC: CSSProperties = { fontFamily: '"Noto Music", system-ui, sans-serif', fontSize: 22, lineHeight: 1 };
const DIGIT: CSSProperties = { fontSize: 16, lineHeight: 1, fontWeight: 600 };
const WORD: CSSProperties = { fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 15, lineHeight: 1, fontStyle: "italic", fontWeight: 700 };

/** A class as engraved; an unknown one by its name. */
export function Glyph({ label }: { label: string }): ReactNode {
  const text = TEXT[label];
  if (text !== undefined) {
    return (
      <span data-stylus-glyph={label} style={MUSIC}>
        {text}
      </span>
    );
  }
  const digit = DIGITS[label];
  if (digit !== undefined) {
    return (
      <span data-stylus-glyph={label} style={DIGIT}>
        {digit}
      </span>
    );
  }
  const word = WORDS[label];
  if (word !== undefined) {
    return (
      <span data-stylus-glyph={label} style={WORD}>
        {word}
      </span>
    );
  }
  if (label === "mordent") {
    return (
      <svg data-stylus-glyph={label} width={28} height={20} viewBox="0 0 28 20" style={{ display: "block" }}>
        <path d="M2 12 l5 -6 5 6 5 -6 5 6 4 -5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinejoin="round" />
        <path d="M14 2 v16" stroke="currentColor" strokeWidth={2.2} />
      </svg>
    );
  }
  if (label === "tie") {
    return (
      <svg data-stylus-glyph={label} width={30} height={16} viewBox="0 0 30 16" fill="currentColor" style={{ display: "block" }}>
        <circle cx={5} cy={9} r={3} />
        <circle cx={25} cy={9} r={3} />
        <path d="M6 6 Q15 -2 24 6 Q15 2 6 6 Z" />
      </svg>
    );
  }
  if (label === "slur") {
    return (
      <svg data-stylus-glyph={label} width={30} height={18} viewBox="0 0 30 18" fill="currentColor" style={{ display: "block" }}>
        <circle cx={5} cy={13} r={3} />
        <circle cx={25} cy={7} r={3} />
        <path d="M6 9 Q15 -1 24 3 Q15 4 6 9 Z" />
      </svg>
    );
  }
  return <span data-stylus-glyph={label}>{nameOf(label)}</span>;
}
