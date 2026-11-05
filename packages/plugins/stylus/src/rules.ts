/**
 * Handwriting's second half, as pure functions: where a symbol sits
 * (granita's context, from the host's reading of its centre), the rules the
 * model cannot learn (the user's brief, 2026-11-01: the augmentation dot
 * is right of a note and a staccato above or below one; accidentals are
 * left of a note; fingerings and dynamics are never inside the staff;
 * clefs and rests only inside it, a clef at the measure's start), and what
 * each class granita keeps for battuta writes — a `core.mark` on the note
 * beside the symbol or the event under it, a `core.enterNote` for a drawn
 * note, a `core.erase` for the quarter rest, which is the eraser. The
 * classes are granita's battuta variant (v8, 2026-11-02, the user's list):
 * no barline, no double accidentals, no pedal, no `m` or `z` alone, no
 * 32nd or 64th note, no rest but the quarter; the repeat marks came in.
 * A class the model answers but the table lacks is not offered.
 *
 * `choose` takes the classifier's answers by confidence and writes the
 * first whose rule the symbol's place passes, when it is sure enough;
 * otherwise it asks for a choice among the top three (the user's decision).
 */
import type { CommandMessage, Mark, Pitch, StylusRecognition, StylusScorePoint, StylusSymbolContext } from "@battuta/api";
import type { Box, Point, Symbol } from "./handwriting";

/** Below this confidence the plugin asks rather than writes. */
export const THRESHOLD = 0.5;
/** How many of the classifier's answers the chooser offers. */
export const CHOICES = 3;

/** Staff spaces a symbol may stick out past the note's body and still count as over or beside it (granita's `NOTE_MARGIN`). */
export const NOTE_MARGIN = 0.5;

/**
 * Where the symbol sits, in staff spaces, from the host's reading of its centre
 * (`ctx.stylus.at`): the note offsets from the centre of the nearest note's
 * body — head, stem and flag — and that body's size, as granita v8 measures them.
 */
export function contextOf(box: Box, at: StylusScorePoint): StylusSymbolContext {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const s = at.staff.space;
  const b = at.nearestNote?.box;
  return {
    yStaff: (cy - at.staff.middleY) / s,
    xMeasure: (cx - at.measure.left) / (at.measure.right - at.measure.left),
    barline: Math.min(cx - at.measure.left, at.measure.right - cx) / s,
    noteDx: b ? (cx - (b.left + b.right) / 2) / s : null,
    noteDy: b ? (cy - (b.top + b.bottom) / 2) / s : null,
    noteW: b ? (b.right - b.left) / s : null,
    noteH: b ? (b.bottom - b.top) / s : null,
    width: (box.maxX - box.minX) / s,
    height: (box.maxY - box.minY) / s,
  };
}

/** The place in words, with granita's own thresholds (context.py, v8: the note's body plus half a space). */
export interface Place {
  /** The centre within two spaces of the middle line: between the lines, or just outside. */
  inStaff: boolean;
  above: boolean;
  below: boolean;
  hasNote: boolean;
  /** Beside the nearest note's body — within half a space of its top and bottom — and left of it, or right of it. */
  left: boolean;
  right: boolean;
  /** Over the body — within half a space of its sides — and above it, or below it. */
  aboveNote: boolean;
  belowNote: boolean;
  /** In the first third of the measure. */
  atStart: boolean;
  /** On the note itself: the centre inside its body. */
  onNote: boolean;
}

export function placeOf(c: StylusSymbolContext): Place {
  const hasNote = c.noteDx !== null && c.noteDy !== null;
  const dx = c.noteDx ?? 0;
  const dy = c.noteDy ?? 0;
  const hw = 0.5 * (c.noteW ?? 0);
  const hh = 0.5 * (c.noteH ?? 0);
  const over = hasNote && Math.abs(dx) <= hw + NOTE_MARGIN;
  const beside = hasNote && Math.abs(dy) <= hh + NOTE_MARGIN;
  return {
    inStaff: Math.abs(c.yStaff) <= 2,
    above: c.yStaff < -2,
    below: c.yStaff > 2,
    hasNote,
    left: beside && dx < -hw,
    right: beside && dx > hw,
    aboveNote: over && dy < -hh,
    belowNote: over && dy > hh,
    atStart: c.xMeasure < 0.3,
    onNote: hasNote && Math.abs(dx) <= hw && Math.abs(dy) <= hh,
  };
}

/**
 * The events a symbol can write on: the one under it across; the notehead
 * nearest it; the notehead to its left and the one to its right (a dot
 * belongs to the note before it, an accidental to the note after it — the
 * nearest may be the wrong one when notes are close); and the notehead in
 * its column, for what sits above or below a note.
 */
export interface Targets {
  event: string | null;
  note: string | null;
  left: string | null;
  right: string | null;
  column: string | null;
  /** The mark under the symbol, for the eraser: one that stands on its own, within reach of the symbol's centre and nearer than the note in its column. */
  mark: { id: string; kind: string } | null;
}

/**
 * Where a drawn note's head is, in page px: a stemmed note is the end with
 * more of the pen's samples (the head is drawn round and slow, the stem in
 * one pass); a symbol under two spaces tall has no stem, and its centre is
 * its head.
 */
export function headOf(s: Symbol, staffSpace: number): Point {
  const points = s.strokes.flat();
  const height = s.box.maxY - s.box.minY;
  const centre: Point = [(s.box.minX + s.box.maxX) / 2, (s.box.minY + s.box.maxY) / 2];
  if (height <= 2 * staffSpace || points.length === 0) return centre;
  const third = height / 3;
  const top = points.filter((p) => p[1] < s.box.minY + third);
  const bottom = points.filter((p) => p[1] > s.box.maxY - third);
  const head = top.length > bottom.length ? top : bottom;
  if (head.length === 0) return centre;
  return [head.reduce((a, p) => a + p[0], 0) / head.length, head.reduce((a, p) => a + p[1], 0) / head.length];
}

const mark = (eventId: string, m: Mark): CommandMessage => ({ type: "core.mark", eventId, mark: m });
const erase = (id: string): CommandMessage => ({ type: "core.erase", id });

/** One of granita's classes: what the symbol is called, where it may sit, what it writes — or why it cannot. */
interface Rule {
  name: string;
  fits: (p: Place, t: Targets) => boolean;
  write: (t: Targets, headPitch: Pitch | null) => CommandMessage | string;
}

/** On the note before the symbol (a dot), after it (an accidental), or in its column (a mark above or below it); the nearest when there is no such neighbour. */
const onNote = (what: string, side: "left" | "right" | "column", m: Mark) => (t: Targets): CommandMessage | string => {
  const id = t[side] ?? t.note;
  return id ? mark(id, m) : `${what} needs a note ${side === "left" ? "before" : side === "right" ? "after" : "under or over"} it`;
};
const onEvent = (what: string, m: Mark) => (t: Targets): CommandMessage | string => (t.event ? mark(t.event, m) : `${what} needs an event under it`);
const DUR: Record<string, string> = { Whole: "1", Half: "2", Quarter: "4", "8th": "8", "16th": "16", "32nd": "32", "64th": "64" };
const DUR_NAMES: Record<string, string> = { "1": "whole", "2": "half", "4": "quarter", "8": "eighth", "16": "16th", "32": "32nd", "64": "64th" };

/** A note under or over the symbol: the one in its column, else the nearest when it sits above or below it. */
const overNote = (p: Place, t: Targets): boolean => t.column !== null || (p.hasNote && (p.aboveNote || p.belowNote));
const nearStaff = (p: Place): boolean => !p.above && !p.below;

function note(dur: string): Rule {
  return {
    name: `${DUR_NAMES[dur]} note`,
    fits: (p) => nearStaff(p) || p.hasNote,
    write: (t, head) => (!t.event ? "a note needs an event to write over" : !head ? "no pitch under the notehead" : { type: "core.enterNote", eventId: t.event, pname: head.pname, oct: head.oct, dur }),
  };
}

/**
 * The quarter rest is the eraser (the user, 2026-11-02): rests are what
 * notes do not take, so none is written by hand — touching a note (in its
 * column, inside the staff or on its head) it deletes the note to rests;
 * touching a mark that stands on its own (a dynamic, a fingering, a
 * fermata, an ornament) it removes the mark.
 */
const ERASER: Rule = {
  name: "erase",
  fits: (p, t) => t.mark !== null || (t.column !== null && (p.inStaff || p.onNote)),
  write: (t) => (t.mark ? erase(t.mark.id) : t.column ? erase(t.column) : "the eraser needs a note or a mark under it"),
};

/** Above or below a note, like a fingering. */
const overStaffNote = (p: Place, t: Targets): boolean => !p.inStaff && (t.column !== null || p.hasNote);

function fingering(n: "1" | "2" | "3" | "4" | "5"): Rule {
  return { name: `fingering ${n}`, fits: overStaffNote, write: onNote("a fingering", "column", { kind: "fingering", finger: n }) };
}

function ornament(name: string, ornament: "trill" | "mordent" | "turn"): Rule {
  return { name, fits: overStaffNote, write: onNote(`a ${name}`, "column", { kind: "ornament", ornament }) };
}

/** A repeat mark — the coda and segno signs, Fine, D.S., D.C. — above or below the staff, on the event under it. */
function repeatMark(name: string, mark: "coda" | "segno" | "fine" | "dalSegno" | "daCapo"): Rule {
  return { name, fits: (p) => !p.inStaff, write: onEvent(`a ${name}`, { kind: "repeatMark", mark }) };
}

function articulation(name: string, artic: "stacc" | "ten" | "acc" | "stacciss" | "marc"): Rule {
  return { name, fits: overNote, write: onNote(`a ${name}`, "column", { kind: "articulation", artic }) };
}

function accidental(name: string, accid: "s" | "f" | "n" | "x"): Rule {
  // Before the note it alters: the one to the symbol's right.
  return { name, fits: (p, t) => t.right !== null || p.left, write: onNote(`a ${name}`, "right", { kind: "accidental", accid }) };
}

const CLASSES: Record<string, Rule> = {
  fing1: fingering("1"),
  fing2: fingering("2"),
  fing3: fingering("3"),
  fing4: fingering("4"),
  fing5: fingering("5"),
  trill: ornament("trill", "trill"),
  mordent: ornament("mordent", "mordent"),
  turn: ornament("turn", "turn"),
  fermata: { name: "fermata", fits: overNote, write: onNote("a fermata", "column", { kind: "fermata" }) },
  // Before the chord it rolls: the one to the symbol's right (a single note is refused by the editor).
  arpeg: { name: "arpeggio", fits: (p, t) => t.right !== null || p.left, write: onNote("an arpeggio", "right", { kind: "ornament", ornament: "arpeg" }) },
  articStaccatoAbove: articulation("staccato", "stacc"),
  articTenutoAbove: articulation("tenuto", "ten"),
  articAccentAbove: articulation("accent", "acc"),
  articStaccatissimoAbove: articulation("staccatissimo", "stacciss"),
  articMarcatoAbove: articulation("marcato", "marc"),
  accidentalFlat: accidental("flat", "f"),
  accidentalNatural: accidental("natural", "n"),
  accidentalSharp: accidental("sharp", "s"),
  dynamicPiano: { name: "p", fits: (p) => p.below, write: onEvent("a dynamic", { kind: "dynamic", value: "p" }) },
  dynamicForte: { name: "f", fits: (p) => p.below, write: onEvent("a dynamic", { kind: "dynamic", value: "f" }) },
  dynamicSforzando: { name: "sfz", fits: (p) => p.below, write: onEvent("a dynamic", { kind: "dynamic", value: "sfz" }) },
  dynamicPP: { name: "pp", fits: (p) => p.below, write: onEvent("a dynamic", { kind: "dynamic", value: "pp" }) },
  dynamicMP: { name: "mp", fits: (p) => p.below, write: onEvent("a dynamic", { kind: "dynamic", value: "mp" }) },
  dynamicMF: { name: "mf", fits: (p) => p.below, write: onEvent("a dynamic", { kind: "dynamic", value: "mf" }) },
  dynamicFF: { name: "ff", fits: (p) => p.below, write: onEvent("a dynamic", { kind: "dynamic", value: "ff" }) },
  dynamicFFF: { name: "fff", fits: (p) => p.below, write: onEvent("a dynamic", { kind: "dynamic", value: "fff" }) },
  dynamicForzando: { name: "fz", fits: (p) => p.below, write: onEvent("a dynamic", { kind: "dynamic", value: "fz" }) },
  dynamicSforzato: { name: "sf", fits: (p) => p.below, write: onEvent("a dynamic", { kind: "dynamic", value: "sf" }) },
  noteWhole: note(DUR["Whole"]!),
  noteHalf: note(DUR["Half"]!),
  noteQuarter: note(DUR["Quarter"]!),
  note8th: note(DUR["8th"]!),
  note16th: note(DUR["16th"]!),
  // After the note it lengthens: the one to the symbol's left.
  augmentationDot: { name: "augmentation dot", fits: (p, t) => t.left !== null || p.right, write: onNote("a dot", "left", { kind: "dot" }) },
  restQuarter: ERASER,
  gClef: { name: "G clef", fits: (p) => p.inStaff && p.atStart, write: onEvent("a clef", { kind: "clef", shape: "G" }) },
  fClef: { name: "F clef", fits: (p) => p.inStaff && p.atStart, write: onEvent("a clef", { kind: "clef", shape: "F" }) },
  cClef: { name: "C clef", fits: (p) => p.inStaff && p.atStart, write: onEvent("a clef", { kind: "clef", shape: "C" }) },
  coda: repeatMark("coda", "coda"),
  segno: repeatMark("segno", "segno"),
  fine: repeatMark("Fine", "fine"),
  dalSegno: repeatMark("D.S.", "dalSegno"),
  daCapo: repeatMark("D.C.", "daCapo"),
};

/** The symbol's name for a class — the notices, a button's title; the label and the chooser show the glyph (`glyphs.tsx`). */
export const nameOf = (label: string): string => CLASSES[label]?.name ?? label;

/** Every class the plugin writes. */
export const CLASS_LABELS: readonly string[] = Object.keys(CLASSES);

export type Outcome =
  /** Sure enough, and the place fits: the message to send, and the other answers to offer if the user says no. */
  | { kind: "write"; label: string; name: string; confidence: number; message: CommandMessage; options: readonly StylusRecognition[] }
  /** Not sure, or nothing fits where it sits: ask among the top answers. */
  | { kind: "choose"; options: readonly StylusRecognition[] }
  /** The class is read but the editor cannot write it here. */
  | { kind: "nothing"; label: string; reason: string };

/** What one class writes here, regardless of where it sits — the chooser's pick. */
export function writeAs(label: string, confidence: number, targets: Targets, headPitch: Pitch | null, options: readonly StylusRecognition[] = []): Outcome {
  const rule = CLASSES[label];
  if (!rule) return { kind: "nothing", label, reason: `${label}: not a symbol the editor knows` };
  const m = rule.write(targets, headPitch);
  return typeof m === "string" ? { kind: "nothing", label, reason: m } : { kind: "write", label, name: rule.name, confidence, message: m, options };
}

/**
 * The classifier's answers, best first, against the symbol's place: only the
 * readings that belong where it sits count — for the write, and for the
 * chooser (the user, 2026-11-01: a fingering inside the staff must not even
 * be offered). None belonging: a notice naming the best reading.
 */
export function choose(top: readonly StylusRecognition[], context: StylusSymbolContext, targets: Targets, headPitch: Pitch | null): Outcome {
  const place = placeOf(context);
  const sorted = [...top].sort((a, b) => b.confidence - a.confidence);
  const fitting = sorted.filter((r) => CLASSES[r.label]?.fits(place, targets));
  const options = fitting.slice(0, CHOICES);
  const first = fitting[0];
  if (!first) {
    const best = sorted[0];
    return { kind: "nothing", label: best?.label ?? "", reason: best ? `nothing that belongs here — read as ${nameOf(best.label)} (${Math.round(best.confidence * 100)} %)` : "nothing read" };
  }
  if (first.confidence < THRESHOLD) return { kind: "choose", options };
  return writeAs(first.label, first.confidence, targets, headPitch, options);
}
