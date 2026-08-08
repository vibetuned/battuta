/**
 * Harmony annotations — two lanes over the same MEI element:
 *  - chord symbols (<harm place="above">Cmaj7…)
 *  - Roman numeral analysis (<harm place="below" type="rna">V65/IV…)
 * Both are startid-anchored control events in the event's measure, so
 * tiles, copy/paste, and undo treat them like any other control event.
 * The grammars are closed: validators say whether a buffer is a complete
 * symbol, charsets say which keys may extend one, and the suggestion
 * helpers drive the editor's autosuggest.
 */
import { CoreElement, childElements } from "./xml.js";
import { Command, CommandContext, DirtyRegion } from "./commands.js";
import { newId } from "./ids.js";

export type HarmKind = "chord" | "rna";

/* ------------------------------------------------------------------ */
/* Grammars                                                            */

const CHORD_RE =
  /^[A-G][b#]?(?:maj|ma|min|dim|aug|sus[24]|add\d{1,2}|alt|M|m|ø|°|Δ|\+|-)?\d{0,2}(?:[b#]\d{1,2}|alt)*(?:\/[A-G][b#]?)?$/;

const NUMERAL = "(?:VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)";
const RNA_RE = new RegExp(
  `^[b#]?(?:${NUMERAL}(?:°|ø|\\+)?(?:65|64|63|43|42|7|6|2)?|N6?|(?:It|Fr|Ger)\\+?6?)` + `(?:/[b#]?${NUMERAL})?$`,
);

export const isChordSymbol = (text: string): boolean => CHORD_RE.test(text);
export const isRomanNumeral = (text: string): boolean => RNA_RE.test(text);
export const isHarmText = (kind: HarmKind, text: string): boolean => (kind === "chord" ? isChordSymbol(text) : isRomanNumeral(text));

/** Which single characters may appear in a buffer of this kind at all. */
export const HARM_CHARS: Record<HarmKind, RegExp> = {
  chord: /^[A-G]$|^[b#]$|^[0-9]$|^[madjinugslt]$|^[MΔø°+/-]$/,
  rna: /^[IViv]$|^[b#]$|^[2-7]$|^[NtFrGe]$|^[°øo0+/]$/,
};

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

/** Completions for the current buffer (the editor's autosuggest). */
export function harmSuggestions(kind: HarmKind, buffer: string): string[] {
  let pool: string[];
  if (kind === "chord") {
    const m = /^([A-G][b#]?)/.exec(buffer);
    if (!m) return ["C", "D", "E", "F", "G", "A", "B"].filter((r) => r.startsWith(buffer));
    const root = m[1]!;
    pool = CHORD_QUALITIES.map((q) => root + q);
    // keep a slash continuation available once the head is complete
    if (isChordSymbol(buffer) && !buffer.includes("/")) pool.push(buffer + "/");
  } else {
    const slash = buffer.indexOf("/");
    if (slash >= 0) {
      const head = buffer.slice(0, slash + 1);
      pool = RNA_BASES.filter((b) => !b.includes("+6")).map((b) => head + b);
    } else {
      pool = [...RNA_BASES];
      if (isRomanNumeral(buffer)) pool.push(buffer + "/");
    }
  }
  return pool.filter((s) => s.startsWith(buffer) && s !== buffer).slice(0, 6);
}

/* ------------------------------------------------------------------ */

const deref = (v: string | undefined) => (v ? v.replace(/^#/, "") : undefined);

const isKind = (el: CoreElement, kind: HarmKind): boolean => (kind === "rna" ? el.attrs["type"] === "rna" : el.attrs["type"] !== "rna");

/** The existing harm text of this kind anchored at the event, if any. */
export function harmTextAt(measure: CoreElement, targetId: string, kind: HarmKind): string {
  const el = childElements(measure).find((c) => c.tag === "harm" && deref(c.attrs["startid"]) === targetId && isKind(c, kind));
  return el ? el.children.filter((c): c is string => typeof c === "string").join("") : "";
}

/**
 * Set (create/replace) or clear (empty text) the harm of one kind at an
 * event. Chord symbols sit above the staff, numerals below.
 */
export class SetHarmCommand implements Command {
  readonly label: string;
  private memento: { measure: CoreElement; at: number; before: CoreElement | null; after: CoreElement | null } | null = null;
  private region: DirtyRegion[] = [];

  constructor(
    private readonly targetId: string,
    private readonly text: string,
    private readonly kind: HarmKind,
  ) {
    this.label = `${kind === "rna" ? "numeral" : "chord"} "${text}"`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    if (this.text !== "" && !isHarmText(this.kind, this.text)) throw new Error(`not a valid ${this.kind === "rna" ? "numeral" : "chord symbol"}: "${this.text}"`);
    const ref = ctx.index.byId.get(this.targetId);
    if (!ref) throw new Error("harmony target not found");
    const measure = ctx.score.measures[ref.measureIndex];
    if (!measure) throw new Error("measure not found");
    this.region = [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
    const existing = childElements(measure).find((c) => c.tag === "harm" && deref(c.attrs["startid"]) === this.targetId && isKind(c, this.kind)) ?? null;
    if (existing && this.text === "") {
      const at = measure.children.indexOf(existing);
      measure.children.splice(at, 1);
      this.memento = { measure, at, before: existing, after: null };
    } else if (existing) {
      const at = measure.children.indexOf(existing);
      const next: CoreElement = { ...existing, attrs: { ...existing.attrs }, children: [this.text] };
      measure.children[at] = next;
      this.memento = { measure, at, before: existing, after: next };
    } else if (this.text !== "") {
      const attrs: Record<string, string> = {
        "xml:id": newId(),
        staff: String(ref.staffN),
        startid: `#${this.targetId}`,
        place: this.kind === "rna" ? "below" : "above",
      };
      if (this.kind === "rna") attrs["type"] = "rna";
      const el: CoreElement = { tag: "harm", attrs, children: [this.text] };
      measure.children.push(el);
      this.memento = { measure, at: measure.children.length - 1, before: null, after: el };
    } else {
      this.memento = null; // clearing nothing: a no-op
    }
    return this.region;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const m = this.memento;
    if (m.before === null && m.after) m.measure.children.splice(m.measure.children.indexOf(m.after), 1);
    else if (m.after === null && m.before) m.measure.children.splice(m.at, 0, m.before);
    else if (m.before) m.measure.children[m.at] = m.before;
    return this.region;
  }
}
