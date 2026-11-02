/**
 * Commands as data. A plugin mutates the document by handing the host a
 * serializable message; the host owns the mapping from message to the
 * real core command (`apps/editor/src/host/messages.ts`) and runs it as
 * one undo step. A plugin therefore cannot mutate in any way the host has
 * not published here — and cannot construct a command at all, because
 * `@battuta/core` is not reachable from a plugin package.
 *
 * Adding a message = one member of this union + one case in the host's
 * `toCommand` + a mapping test + an API version bump. Every planned slice
 * maps onto a command that already exists in core (setPitches for the
 * reflection cycle, setSyl for lyrics, setHarm for harmony); a plugin
 * that thinks it needs a NEW command is asking for a core change first.
 */
import type { HarmKind, PitchEvent, SylValue } from "./document.js";

/** Write pitch content onto events (notes in child order for chords). Byte-identical revert. */
export interface SetPitchesMessage {
  type: "core.setPitches";
  targets: PitchEvent[];
  /** Undo-stack label, shown nowhere yet but recorded. */
  label: string;
}

/**
 * Set (or, with empty text, clear) the verse-1 syllable of a note or
 * chord. Refused on a rest. One undo step; byte-identical revert. The
 * command labels itself (`lyric "hel"`, `lyric removed`).
 */
export interface SetSylMessage {
  type: "core.setSyl";
  eventId: string;
  value: SylValue;
}

/**
 * Set (or, with empty text, clear) the harmony of one kind at an event —
 * a chord symbol above or a Roman numeral below. Refused when the text is
 * not one core's grammar accepts — `ctx.query.harmValid` asks the same
 * grammar, so a lane checks before it builds the message and a generator
 * filters before it writes. One undo step; byte-identical revert; labels
 * itself.
 */
export interface SetHarmMessage {
  type: "core.setHarm";
  eventId: string;
  kind: HarmKind;
  text: string;
}

/**
 * Enter a note at an event, as the keyboard does in entry mode (1.3.0, the
 * stylus): overwrite — the event (note, chord, rest or a measure rest)
 * becomes a note of this pitch and written duration; a shorter one leaves
 * rests for the rest of the time, a longer one takes the following events
 * of its layer. Refused when it would cross a beam, tuplet or barline.
 * The key signature supplies the accidental. One undo step; labels itself.
 * The caret goes to the note it wrote (1.3.3).
 */
export interface EnterNoteMessage {
  type: "core.enterNote";
  eventId: string;
  pname: string;
  oct: number;
  /** Written duration: "1" whole, "2" half, "4" quarter … "64". */
  dur: string;
  /** Dots: 0 (the default), 1 or 2. */
  dots?: number;
}

/**
 * Add a pitch to a note or a chord, as Shift + a letter does (1.3.2, the
 * stylus): a note becomes a chord of the two, a chord grows. Refused on a
 * rest, and for a pitch the chord already has. The key signature supplies
 * the accidental. One undo step; labels itself. The caret goes to the
 * chord (1.3.3).
 */
export interface AddChordNoteMessage {
  type: "core.addChordNote";
  eventId: string;
  pname: string;
  oct: number;
}

/**
 * A mark on an event, as the keyboard's keys put them (1.3.5, the stylus):
 * the accidental, articulation, dot, fermata, dynamic, fingering and pedal
 * keys on a note, chord or rest; a clef at the event's measure on its
 * staff; a rest entered over the event, as `core.enterNote` enters a note.
 * Each toggles as its key does: the same mark again takes it away.
 */
export type Mark =
  | { kind: "accidental"; accid: "s" | "f" | "n" | "x" }
  | { kind: "articulation"; artic: "stacc" | "ten" | "acc" | "stacciss" | "marc" }
  | { kind: "dot" }
  | { kind: "fermata" }
  /** The dynamic's text: "p", "mf", "sfz" … one to four letters. */
  | { kind: "dynamic"; value: string }
  | { kind: "fingering"; finger: "1" | "2" | "3" | "4" | "5" }
  /** A pedal from the event to `endId`, as the keyboard's pedal spans a selection; refused on one event alone. */
  | { kind: "pedal"; endId: string }
  /** G on the second line, F on the fourth, C on the third. */
  | { kind: "clef"; shape: "G" | "F" | "C" }
  /** Written duration as `core.enterNote`'s; the rest replaces the event. */
  | { kind: "rest"; dur: string; dots?: number }
  /** An ornament by name (1.3.7), where the ornament key cycles them: the same one again takes it off, another replaces it. The arpeggio needs a chord. */
  | { kind: "ornament"; ornament: "arpeg" | "trill" | "mordent" | "turn" }
  /** A repeat mark by name (1.3.8), where the coda key cycles them — the coda sign, "To Coda", the segno, Fine, D.S., D.C.: the same one again takes it off, another replaces it. */
  | { kind: "repeatMark"; mark: "coda" | "toCoda" | "segno" | "fine" | "dalSegno" | "daCapo" }
  /** A tie from the event to `endId` (1.3.9), either order, as the tie key ties a note to its neighbour: the same pitch on both, consecutive in their layer — or every event between them a link of the chain, as the key does over a run. The same again unties. Refused across staves or layers, and where the pitches differ. */
  | { kind: "tie"; endId: string }
  /** A slur from the event to `endId` (1.3.9), either order, as the slur key spans a selection; the same again removes it. Notes and chords only. */
  | { kind: "slur"; endId: string };

/**
 * Put a mark on an event (1.3.5, the stylus). One undo step; labels itself.
 * The caret goes to the event (to the rest, for a rest).
 */
export interface MarkMessage {
  type: "core.mark";
  eventId: string;
  mark: Mark;
}

/**
 * Erase what stands at `id` (1.3.7, the stylus's eraser): a note or a chord
 * — a chord's note names its chord — is deleted to rests, its time left as
 * rests the way the Delete key leaves it; a mark that stands on its own
 * (a dynamic, a fingering, a fermata, an ornament, a repeat mark —
 * `StylusScorePoint.nearestMark`) is removed whatever its state. A rest,
 * a pedal, and what is part of its note (an articulation, an accidental,
 * a dot: the same mark again takes it off) are refused. One undo step;
 * the caret goes to the rest that took the note's place, or to the event
 * the mark was on.
 */
export interface EraseMessage {
  type: "core.erase";
  id: string;
}

export type CommandMessage = SetPitchesMessage | SetSylMessage | SetHarmMessage | EnterNoteMessage | AddChordNoteMessage | MarkMessage | EraseMessage;

export type CommandMessageType = CommandMessage["type"];

export const COMMAND_MESSAGE_TYPES: readonly CommandMessageType[] = ["core.setPitches", "core.setSyl", "core.setHarm", "core.enterNote", "core.addChordNote", "core.mark", "core.erase"];
