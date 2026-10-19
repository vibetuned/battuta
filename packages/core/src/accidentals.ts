/**
 * Accidentals, written and sounding. MEI keeps two: @accid, the accidental
 * on the page, and @accid.ges, the one the note SOUNDS with — which a
 * reader of the page supplies: the key signature, unless a written
 * accidental earlier in the measure (same staff, letter and octave) has
 * changed it, and a note tied in keeps the pitch it is tied from.
 *
 * battuta writes @accid.ges into the document, on open and after every
 * edit (as part of the edit's undo step), wherever a note without a
 * written accidental sounds altered — the convention of Verovio's own
 * imports (a B under one flat carries accid.ges="f"; a natural sounds
 * natural and carries none). Without it every other reader — Verovio's
 * MIDI values among them, probed with 6.2.0 — hears the bare letter: a B♭
 * written as the key spells it would sound B♮ everywhere but in battuta.
 *
 * Both of MEI's forms are read and written: the attributes on <note>, or
 * an <accid> child (the element form imports use, which may carry more —
 * an id, a cautionary flag). A note with an <accid> child keeps its
 * accidentals there.
 *
 * MIDI entry asks here too: a key pressed becomes a letter and an
 * accidental, spelled the way the key reads.
 */
import { CoreElement, childElements, findAll } from "./xml.js";
import { CoreScore } from "./score.js";
import { MeasureContext, resolveContexts } from "./context.js";
import { Fraction, F0, fAdd, fCmp, fMul, frac, eventDuration } from "./durations.js";
import type { Command, CommandContext, DirtyRegion } from "./commands.js";

/** Semitones of an MEI accidental value (written or gestural). */
const ALTER: Record<string, number> = { s: 1, f: -1, n: 0, x: 2, ss: 2, ff: -2, ts: 3, tf: -3, xs: 3, sx: 3, ns: 1, nf: -1 };
/** The gestural value for a sounding alteration. */
const GES: Record<string, string> = { "1": "s", "-1": "f", "0": "n", "2": "ss", "-2": "ff", "3": "ts", "-3": "tf" };

const SHARPS = ["f", "c", "g", "d", "a", "e", "b"];

/** Signed fifths of an MEI keysig ("3s" → 3, "2f" → -2, "0" → 0; anything else 0). */
export function keyFifths(keysig: string): number {
  const m = /^([0-7])([sf])$/.exec(keysig);
  return m ? Number(m[1]) * (m[2] === "s" ? 1 : -1) : 0;
}

/** The alteration a key signature gives a letter. */
function keyAlter(fifths: number, pname: string): number {
  const at = SHARPS.indexOf(pname);
  if (at < 0) return 0;
  if (fifths > 0) return at < fifths ? 1 : 0;
  return 6 - at < -fifths ? -1 : 0;
}

/** A note's <accid> child, when it uses MEI's element form. */
export function accidChild(note: CoreElement): CoreElement | undefined {
  return childElements(note).find((c) => c.tag === "accid");
}

/** A note's written accidental: its <accid> child's, else @accid. */
export function writtenAccid(note: CoreElement): string | undefined {
  return accidChild(note)?.attrs["accid"] ?? note.attrs["accid"];
}

/** A note's gestural accidental: its <accid> child's, else @accid.ges. */
export function gesturalAccid(note: CoreElement): string | undefined {
  return accidChild(note)?.attrs["accid.ges"] ?? note.attrs["accid.ges"];
}

/**
 * Set (or with `undefined` remove) one of a note's accidentals where the
 * note keeps them: on its <accid> child when it has one — the same
 * attribute on the note itself is then removed, never left to contradict
 * it — else on the note.
 */
export function setAccid(note: CoreElement, which: "accid" | "accid.ges", value: string | undefined): void {
  const child = accidChild(note);
  if (child) delete note.attrs[which];
  const holder = child ?? note;
  if (value === undefined) delete holder.attrs[which];
  else holder.attrs[which] = value;
}

/** Attribute snapshots of a note and its <accid> child, for exact reverts. */
export type AccidMemento = { el: CoreElement; before: Record<string, string> }[];
export function accidMemento(note: CoreElement): AccidMemento {
  const child = accidChild(note);
  return [{ el: note, before: { ...note.attrs } }, ...(child ? [{ el: child, before: { ...child.attrs } }] : [])];
}
export function restoreAccidMemento(m: AccidMemento): void {
  for (const { el, before } of m) el.attrs = { ...before };
}

interface Timed {
  note: CoreElement;
  /** The note or chord that holds the note — what the event index knows. */
  event: CoreElement;
  layerN: string;
  onset: Fraction;
}

/** Every note of a staff in time order (layers merged; ties keep layer order). */
function staffTimeline(staff: CoreElement): Timed[] {
  const out: Timed[] = [];
  for (const layer of childElements(staff).filter((c) => c.tag === "layer")) {
    const layerN = layer.attrs["n"] ?? "1";
    const onset = { v: F0 };
    const walk = (el: CoreElement, scale: Fraction): void => {
      for (const c of childElements(el)) {
        if (c.tag === "note" || c.tag === "chord") {
          const notes = c.tag === "note" ? [c] : childElements(c).filter((n) => n.tag === "note");
          for (const note of notes) out.push({ note, event: c, layerN, onset: onset.v });
          onset.v = fAdd(onset.v, fMul(eventDuration(c) ?? F0, scale));
        } else if (c.tag === "rest" || c.tag === "space") {
          onset.v = fAdd(onset.v, fMul(eventDuration(c) ?? F0, scale));
        } else if (c.tag === "tuplet") {
          walk(c, fMul(scale, frac(Number(c.attrs["numbase"] ?? "2"), Number(c.attrs["num"] ?? "3"))));
        } else {
          walk(c, scale); // beam, graceGrp, bTrem, fTrem, …
        }
      }
    };
    walk(layer, frac(1, 1));
  }
  return out.sort((a, b) => fCmp(a.onset, b.onset));
}

/**
 * The gestural accidental each note should carry, as a reader of the page
 * hears it — key signature, the measure's earlier written accidentals,
 * ties carried over (@tie chains and <tie> elements alike) — for every
 * note WITHOUT a written accidental (`undefined`: it sounds natural and
 * carries none). Notes with a written accidental are left out: what they
 * sound is on the page.
 */
function soundingGestural(score: CoreScore, contexts: MeasureContext[]): { note: CoreElement; ges: string | undefined; measureIndex: number; staffN: number }[] {
  const out: { note: CoreElement; ges: string | undefined; measureIndex: number; staffN: number }[] = [];
  // <tie startid endid>: the end note sounds as its start did
  const tieStartOf = new Map<string, string>();
  for (const measure of score.measures) {
    for (const tie of findAll(measure, "tie")) {
      const start = tie.attrs["startid"]?.replace(/^#/, "");
      const end = tie.attrs["endid"]?.replace(/^#/, "");
      if (start && end) tieStartOf.set(end, start);
    }
  }
  const tieStarts = new Set(tieStartOf.values());
  const alterOfStart = new Map<string, number>();
  const tiedFrom = new Map<string, number>(); // @tie chains, per staff/layer/pitch
  score.measures.forEach((measure, m) => {
    for (const staff of childElements(measure).filter((c) => c.tag === "staff")) {
      const staffN = Number(staff.attrs["n"] ?? "1");
      const fifths = keyFifths(contexts[m]?.get(staffN)?.keysig ?? "0");
      const state = new Map<string, number>(); // the measure's written accidentals so far
      for (const t of staffTimeline(staff)) {
        const pname = t.note.attrs["pname"];
        const oct = t.note.attrs["oct"];
        if (!pname || oct === undefined) continue;
        const pitch = `${pname}${oct}`;
        const tieKey = `${staffN}/${t.layerN}/${pitch}`;
        const tie = t.note.attrs["tie"];
        const id = t.note.attrs["xml:id"];
        const w = writtenAccid(t.note);
        const startId = id !== undefined ? tieStartOf.get(id) : undefined;
        let alter: number;
        if (w !== undefined && ALTER[w] !== undefined) {
          alter = ALTER[w]!;
          state.set(pitch, alter);
        } else {
          if (startId !== undefined && alterOfStart.has(startId)) alter = alterOfStart.get(startId)!;
          else if ((tie === "t" || tie === "m") && tiedFrom.has(tieKey)) alter = tiedFrom.get(tieKey)!;
          else alter = state.get(pitch) ?? keyAlter(fifths, pname);
          out.push({ note: t.note, ges: alter === 0 ? undefined : GES[String(alter)], measureIndex: m, staffN });
        }
        if (tie === "i" || tie === "m") tiedFrom.set(tieKey, alter);
        else tiedFrom.delete(tieKey);
        if (id !== undefined && tieStarts.has(id)) alterOfStart.set(id, alter);
      }
    }
  });
  return out;
}

/**
 * Bring every note's @accid.ges in line with what it sounds. Returns what
 * it changed — attribute snapshots to revert by, and the measures touched.
 */
export function syncGesturalAccidentals(score: CoreScore, contexts: MeasureContext[]): { mementos: AccidMemento[]; region: DirtyRegion[] } {
  const mementos: AccidMemento[] = [];
  const region = new Map<string, DirtyRegion>();
  for (const { note, ges, measureIndex, staffN } of soundingGestural(score, contexts)) {
    const child = accidChild(note);
    const current = gesturalAccid(note);
    // in step only when it sits where the note keeps it, uncontradicted
    if (current === ges && (!child || note.attrs["accid.ges"] === undefined)) continue;
    mementos.push(accidMemento(note));
    setAccid(note, "accid.ges", ges);
    region.set(`${measureIndex}/${staffN}`, { measureIndex, staffN });
  }
  return { mementos, region: [...region.values()] };
}

/**
 * A command with the document's gestural accidentals kept in step: the
 * inner command, then the sync — one undo step, reverted sync first.
 * Every edit runs through this (the session wraps them), so an entered
 * note, a toggled accidental, a key change or a transposition leaves the
 * file sounding as written for any reader.
 */
export class WithGesturalAccidentals implements Command {
  readonly label: string;
  private mementos: AccidMemento[] = [];
  private region: DirtyRegion[] = [];

  constructor(readonly inner: Command) {
    this.label = inner.label;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const dirty = this.inner.apply(ctx);
    const synced = syncGesturalAccidentals(ctx.score, resolveContexts(ctx.score));
    this.mementos = synced.mementos;
    this.region = synced.region;
    return mergeRegions(dirty, this.region);
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    for (const m of [...this.mementos].reverse()) restoreAccidMemento(m);
    return mergeRegions(this.inner.revert(ctx), this.region);
  }
}

function mergeRegions(a: DirtyRegion[], b: DirtyRegion[]): DirtyRegion[] {
  const seen = new Set(a.map((r) => `${r.measureIndex}/${r.staffN}`));
  return [...a, ...b.filter((r) => !seen.has(`${r.measureIndex}/${r.staffN}`))];
}

/**
 * The sounding alteration of a letter and octave just BEFORE an event —
 * what a note there without an accidental would sound: the key, unless a
 * written accidental earlier in the measure (same staff) changed it.
 */
export function alterationsBefore(score: CoreScore, contexts: MeasureContext[], measureIndex: number, staffN: number, eventId: string): (pname: string, oct: number) => number {
  const fifths = keyFifths(contexts[measureIndex]?.get(staffN)?.keysig ?? "0");
  const state = new Map<string, number>();
  const measure = score.measures[measureIndex];
  const staff = measure && childElements(measure).find((c) => c.tag === "staff" && Number(c.attrs["n"] ?? "1") === staffN);
  if (staff) {
    const timeline = staffTimeline(staff);
    const target = timeline.find((t) => t.event.attrs["xml:id"] === eventId || t.note.attrs["xml:id"] === eventId);
    for (const t of timeline) {
      if (target && fCmp(t.onset, target.onset) >= 0) break;
      const w = writtenAccid(t.note);
      const pname = t.note.attrs["pname"];
      if (w !== undefined && ALTER[w] !== undefined && pname) state.set(`${pname}${t.note.attrs["oct"]}`, ALTER[w]!);
    }
  }
  return (pname, oct) => state.get(`${pname}${oct}`) ?? keyAlter(fifths, pname);
}

/** Line-of-fifths position → letter (C = 0, G = 1, F = -1, …). */
const FIFTHS_LETTERS = ["f", "c", "g", "d", "a", "e", "b"];

/**
 * Spell a MIDI note under a key. A spelling that needs no accidental where
 * it lands wins (B♭ under one flat is a plain B; after a written B♮ in the
 * measure, B♮ is a plain B too; B♯ in C♯ major is a plain B). Otherwise a
 * white key is its own letter with ♮ written (under one flat, B is B♮; in
 * E major, C is C♮ — never B♯), and a black key the spelling nearest the
 * key on the line of fifths, its accidental written: under one flat C♯
 * (D minor's leading tone) and E♭; in C, C♯ E♭ F♯ G♯ B♭.
 */
export function spellMidi(midi: number, fifths: number, alterationOf: (pname: string, oct: number) => number): { pname: string; oct: number; accid?: string } {
  const pc = ((midi % 12) + 12) % 12;
  const spellings: { pname: string; alter: number; oct: number; fifth: number }[] = [];
  for (let fifth = -8; fifth <= 12; fifth++) {
    if ((((fifth * 7) % 12) + 12) % 12 !== pc) continue;
    const alter = Math.floor((fifth + 1) / 7);
    spellings.push({ pname: FIFTHS_LETTERS[(((fifth + 1) % 7) + 7) % 7]!, alter, oct: Math.floor((midi - alter) / 12) - 1, fifth });
  }
  const centre = fifths + 2.5;
  const byKey = [...spellings].sort((a, b) => Math.abs(a.fifth - centre) - Math.abs(b.fifth - centre));
  const silent = byKey.find((s) => alterationOf(s.pname, s.oct) === s.alter);
  if (silent) return { pname: silent.pname, oct: silent.oct };
  const best = byKey.find((s) => s.alter === 0) ?? byKey[0]!;
  return { pname: best.pname, oct: best.oct, accid: GES[String(best.alter)]! };
}
