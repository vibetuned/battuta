/**
 * Harmony annotations — two lanes over the same MEI element:
 *  - chord symbols (<harm place="above">Cmaj7…)
 *  - Roman numeral analysis (<harm place="below" type="rna">V65/IV…)
 * Both are startid-anchored control events in the event's measure, so
 * tiles, copy/paste, and undo treat them like any other control event.
 * Core keeps the ELEMENT — where a `<harm>` hangs, how to read its text
 * back, how to write it as one undoable step — and its VALIDITY: the two
 * closed grammars that say what text may be written at all. Validity
 * lives here, below every writer, because there will be more than one
 * (the harmony lane today, a generator that reads a measure and writes
 * its harmony tomorrow) and each must be refused the same junk; the api
 * asks the same grammar through `ctx.query.harmValid`, so no plugin
 * carries a copy (decided 2026-09-15). The editor AFFORDANCES — which
 * keys may extend a buffer, what a typed key becomes, what is offered —
 * are the harmony plugin's (`packages/plugins/harmony/src/grammar.ts`).
 */
import { CoreElement, childElements } from "./xml.js";
import { Command, CommandContext, DirtyRegion } from "./commands.js";
import { newId } from "./ids.js";

/** The discriminator of the element: `<harm>` plain and above, or `type="rna"` and below. Re-exported to plugins by `@battuta/api`. */
export type HarmKind = "chord" | "rna";

/* ------------------------------------------------------------------ */
/* Validity: what may be written into a <harm> of each kind            */

const CHORD_RE =
  /^[A-G][b#]?(?:maj|ma|min|dim|aug|sus[24]|add\d{1,2}|alt|M|m|ø|°|Δ|\+|-)?\d{0,2}(?:[b#]\d{1,2}|alt)*(?:\/[A-G][b#]?)?$/;

const NUMERAL = "(?:VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)";
const RNA_RE = new RegExp(
  `^[b#]?(?:${NUMERAL}(?:°|ø|\\+)?(?:65|64|63|43|42|7|6|2)?|N6?|(?:It|Fr|Ger)\\+?6?)` + `(?:/[b#]?${NUMERAL})?$`,
);

export const isChordSymbol = (text: string): boolean => CHORD_RE.test(text);
export const isRomanNumeral = (text: string): boolean => RNA_RE.test(text);
/** Would `SetHarmCommand` accept this text as a harmony of this kind? The api's `harmValid`. */
export const isHarmText = (kind: HarmKind, text: string): boolean => (kind === "chord" ? isChordSymbol(text) : isRomanNumeral(text));

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
