/**
 * What the host's RENDER service hands out about the document, as data:
 * Verovio's timemap. Rendering is a host service (tiles, pages, the
 * timemap), read-only to plugins — a player reads this and decides for
 * itself what to make of it; the host never says how a score is
 * performed.
 *
 * The timemap is of the EXPANDED form: repeats, voltas and one D.S./D.C.
 * jump are unrolled by core before Verovio sees the score, so a repeated
 * pass appears as CLONED ids (`<id>-rendN`) and `idMap` sends each clone
 * back to the engraved id the page SVG actually contains. Millisecond
 * stamps carry the score's own tempo already.
 */

/** One timemap entry: what turns on and off at a real-time millisecond stamp. */
export interface TimemapEvent {
  tstamp: number;
  on?: string[];
  off?: string[];
  /** The measure that starts here (engraved or cloned id), when one does. */
  measureOn?: string;
}

/** The sounding pitch (MIDI number, key signature and accidentals resolved) and written duration in ms of one id. */
export interface TimemapNote {
  pitch: number;
  duration: number;
}

export interface Timemap {
  events: TimemapEvent[];
  notes: Record<string, TimemapNote>;
  /** Cloned repeat-pass id → the engraved id. Absent for ids that are not clones. */
  idMap: Record<string, string>;
}
