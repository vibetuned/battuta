/**
 * The whole of what lyrics knows: which `<syl>` attributes a committed
 * buffer deserves. Pure — no api calls, no host, no MEI — so the rules
 * below can be read as a table and tested as one.
 *
 * MEI writes a word split across notes as `wordpos` i / m / t (initial,
 * medial, terminal) with `con="d"` on every syllable that draws a hyphen
 * to the next. A word that fits on one note carries neither. So the two
 * questions are "does this syllable continue into the next note?" (the key
 * that committed says: `-` does, anything else does not) and "did the
 * PREVIOUS note's syllable continue into this one?" (its `con` says so).
 * Those two booleans are the whole table:
 *
 *   continues · after a continuation →  wordpos "m", con "d"   (…hy-phen-…)
 *   continues · fresh               →  wordpos "i", con "d"    (hel-)
 *   ends      · after a continuation →  wordpos "t"            (-lo)
 *   ends      · fresh               →  no attributes           (world)
 *   empty buffer                    →  cleared
 */

/** One verse-1 syllable, as MEI has it — the api's `SylValue`, restated so this module imports nothing. */
export interface Syllable {
  text: string;
  wordpos?: string;
  con?: string;
}

export interface CommitInput {
  /** What the user typed, as the lane's buffer stands at the commit. */
  buffer: string;
  /** The key that committed: "-", " ", "Enter", "Escape", "ArrowLeft", "ArrowRight". */
  key: string;
  /** The syllable already on this note, or null. */
  existing: Syllable | null;
  /** The syllable on the previous NOTE along the caret path, or null. */
  previous: Syllable | null;
}

/** Does this syllable draw a hyphen to the next note? */
const CONTINUES = "d";

/**
 * The value to write, or null when nothing changed. Null matters: the
 * caret crosses syllables all the time (Escape, arrows, an advance over a
 * note that already reads what the buffer says), and every one of those
 * must leave the document — and the undo stack — untouched.
 */
export function syllableCommit({ buffer, key, existing, previous }: CommitInput): Syllable | null {
  const wasHyphen = existing?.con === CONTINUES;
  const textChanged = buffer !== (existing?.text ?? "");
  // `-` states a hyphen. New text states a word end. Leaving or stepping
  // over an UNCHANGED syllable keeps the hyphenation it already had —
  // slice 5a found the 0.0.3 bug here: Escape used to strip it.
  const hyphen = key === "-" ? true : textChanged ? false : wasHyphen;
  if (!textChanged && hyphen === wasHyphen) return null;
  if (buffer === "") return { text: "" }; // an empty commit clears the syllable
  const midWord = previous?.con === CONTINUES;
  if (hyphen) return { text: buffer, wordpos: midWord ? "m" : "i", con: CONTINUES };
  return midWord ? { text: buffer, wordpos: "t" } : { text: buffer };
}
