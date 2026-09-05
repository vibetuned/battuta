/**
 * Lyrics — one verse of syllables under notes:
 *   <note><verse n="1"><syl wordpos="i" con="d">hel</syl></verse></note>
 * The syllable lives INSIDE the note (unlike harm's startid anchoring),
 * so tiles, copy/paste and undo carry it with the note for free. Chords
 * anchor the verse on their first child note (universally rendered).
 * Word position follows MEI: wordpos i/m/t with con="d" drawing the
 * hyphen to the next syllable; a standalone word has neither.
 */
import { CoreElement, childElements, findAll } from "./xml.js";
import { Command, CommandContext, DirtyRegion } from "./commands.js";
import { newId } from "./ids.js";

export interface SylValue {
  text: string;
  /** i = word start, m = middle, t = end; absent = whole word. */
  wordpos?: string;
  /** "d" = hyphen continues to the next syllable. */
  con?: string;
}

/** The note that carries lyrics for this event (chord → first note). */
function lyricNote(measure: CoreElement, targetId: string): CoreElement | null {
  for (const tag of ["note", "chord"] as const) {
    const el = findAll(measure, tag).find((e) => e.attrs["xml:id"] === targetId);
    if (el) return el.tag === "chord" ? (findAll(el, "note")[0] ?? null) : el;
  }
  return null;
}

/** The event's verse-1 syllable, or null when it has none. */
export function sylAt(measure: CoreElement, targetId: string): SylValue | null {
  const note = lyricNote(measure, targetId);
  const verse = note && childElements(note).find((c) => c.tag === "verse");
  const syl = verse && childElements(verse).find((c) => c.tag === "syl");
  if (!syl) return null;
  const out: SylValue = { text: syl.children.filter((c): c is string => typeof c === "string").join("") };
  if (syl.attrs["wordpos"]) out.wordpos = syl.attrs["wordpos"];
  if (syl.attrs["con"]) out.con = syl.attrs["con"];
  return out;
}

/** Set (create/replace) or clear (empty text) the verse-1 syllable. */
export class SetSylCommand implements Command {
  readonly label: string;
  private memento: { note: CoreElement; at: number; before: CoreElement | null; after: CoreElement | null } | null = null;
  private region: DirtyRegion[] = [];

  constructor(
    private readonly targetId: string,
    private readonly value: SylValue,
  ) {
    this.label = value.text === "" ? "lyric removed" : `lyric "${value.text}"`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const ref = ctx.index.byId.get(this.targetId);
    if (!ref || (ref.tag !== "note" && ref.tag !== "chord")) throw new Error("lyrics attach to a note or chord");
    const measure = ctx.score.measures[ref.measureIndex];
    const note = measure && lyricNote(measure, this.targetId);
    if (!note) throw new Error("lyric target not found");
    this.region = [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
    const existing = childElements(note).find((c) => c.tag === "verse") ?? null;
    if (existing && this.value.text === "") {
      const at = note.children.indexOf(existing);
      note.children.splice(at, 1);
      this.memento = { note, at, before: existing, after: null };
    } else if (this.value.text !== "") {
      const syl: CoreElement = {
        tag: "syl",
        attrs: {
          "xml:id": newId(),
          ...(this.value.wordpos ? { wordpos: this.value.wordpos } : {}),
          ...(this.value.con ? { con: this.value.con } : {}),
        },
        children: [this.value.text],
      };
      const verse: CoreElement = { tag: "verse", attrs: { "xml:id": newId(), n: "1" }, children: [syl] };
      if (existing) {
        const at = note.children.indexOf(existing);
        note.children[at] = verse;
        this.memento = { note, at, before: existing, after: verse };
      } else {
        note.children.push(verse);
        this.memento = { note, at: note.children.length - 1, before: null, after: verse };
      }
    } else {
      this.memento = null; // clearing nothing: a no-op
    }
    return this.region;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const m = this.memento;
    if (m.before === null && m.after) m.note.children.splice(m.note.children.indexOf(m.after), 1);
    else if (m.after === null && m.before) m.note.children.splice(m.at, 0, m.before);
    else if (m.before) m.note.children[m.at] = m.before;
    return this.region;
  }
}
