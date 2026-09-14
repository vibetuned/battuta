/**
 * The harmony lanes' editor affordances: which characters may extend a
 * buffer, what a typed key becomes, and what is offered as a completion.
 * Pure — no api calls, no host, no MEI.
 *
 * What is NOT here: what a complete symbol IS. That grammar is core's
 * (`packages/core/src/harm.ts`), because `core.setHarm` refuses on it and
 * every writer of a harmony — this lane, a future generator — must be
 * refused the same text; the plugin asks it through
 * `ctx.query.harmValid`, which is the lane's `complete` and the predicate
 * `suggestions` takes for its one rule that needs it. Decided 2026-09-15
 * after one slice with the whole grammar here (BUILDING.md §7.2): the
 * offer lives with the feature, the refusal lives below every feature.
 */

/** The two lanes over one event, as the api names them. */
export type Kind = "chord" | "rna";

/** The validity question, as the api answers it (`ctx.query.harmValid`). Injected so this module stays pure and testable. */
export type Valid = (kind: Kind, text: string) => boolean;

/* ------------------------------------------------------------------ */
/* What may be typed                                                   */

/**
 * Which single characters may appear in a buffer of this kind at all —
 * the lane's `accepts`. Moved verbatim from core's `HARM_CHARS`: a key
 * outside the set is simply not admitted, so a buffer can never contain a
 * character the grammar has no use for.
 */
export const CHARS: Record<Kind, RegExp> = {
  chord: /^[A-G]$|^[b#]$|^[0-9]$|^[madjinugslt]$|^[MΔø°+/-]$/,
  rna: /^[IViv]$|^[b#]$|^[2-7]$|^[NtFrGe]$|^[°øo0+/]$/,
};

/**
 * What a typed key becomes in the numeral lane: `o` → `°` (diminished)
 * and `0` → `ø` (half-diminished), because neither is on a keyboard. The
 * chord lane has no transform — its symbols are typed as written, and the
 * two glyphs are in its charset for anyone who can produce them.
 */
export const transformRna = (ch: string): string => (ch === "o" ? "°" : ch === "0" ? "ø" : ch);

const CHORD_QUALITIES = [
  "", "m", "7", "maj7", "m7", "6", "m6", "9", "maj9", "11", "13",
  "dim", "dim7", "m7b5", "ø7", "°7", "aug", "+", "sus4", "sus2",
  "add9", "7b9", "7#9", "7b5", "7#5", "7alt", "-7", "Δ7",
];

const RNA_BASES = [
  "I", "i", "II", "ii", "ii7", "iii", "III", "III+", "IV", "iv", "V", "V7",
  "V65", "V43", "V42", "v", "vi", "VI", "vii°", "vii°7", "viiø7", "VII",
  "I6", "I64", "bII", "bVI", "bIII", "N6", "It+6", "Fr+6", "Ger+6",
];

/** The roots a chord lane offers before any letter is typed. */
const ROOTS = ["C", "D", "E", "F", "G", "A", "B"];

/** How many completions the floating editor shows. */
const LIMIT = 6;

/**
 * Completions for the current buffer — the lane's `suggest`, and what Tab
 * takes the first of. Moved from core's `harmSuggestions`; its one rule
 * that needs the grammar — "keep a slash continuation available once the
 * head is complete" — asks `valid`, the api's `harmValid`, so the offer
 * and the refusal are the same grammar without a copy of it here.
 */
export function suggestions(kind: Kind, buffer: string, valid: Valid): string[] {
  let pool: string[];
  if (kind === "chord") {
    const m = /^([A-G][b#]?)/.exec(buffer);
    if (!m) return ROOTS.filter((r) => r.startsWith(buffer));
    const root = m[1]!;
    pool = CHORD_QUALITIES.map((q) => root + q);
    // keep a slash continuation available once the head is complete
    if (valid("chord", buffer) && !buffer.includes("/")) pool.push(buffer + "/");
  } else {
    const slash = buffer.indexOf("/");
    if (slash >= 0) {
      const head = buffer.slice(0, slash + 1);
      pool = RNA_BASES.filter((b) => !b.includes("+6")).map((b) => head + b);
    } else {
      pool = [...RNA_BASES];
      if (valid("rna", buffer)) pool.push(buffer + "/");
    }
  }
  return pool.filter((s) => s.startsWith(buffer) && s !== buffer).slice(0, LIMIT);
}
