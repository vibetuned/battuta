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

export type CommandMessage = SetPitchesMessage | SetSylMessage | SetHarmMessage | EnterNoteMessage;

export type CommandMessageType = CommandMessage["type"];

export const COMMAND_MESSAGE_TYPES: readonly CommandMessageType[] = ["core.setPitches", "core.setSyl", "core.setHarm", "core.enterNote"];
