/**
 * What a plugin may know about the document — as DATA. Every type here
 * is plain JSON: no classes, no live objects, no core imports. That is
 * what keeps the API message-passing-friendly (a worker host or
 * third-party loading stays a deferral, not a rewrite) and what makes
 * "everything through @battuta/api" true rather than aspirational: there
 * is nothing of the document model here to reach into.
 */

/** Caret position in model coordinates — never pixels. */
export interface CaretPosition {
  measureIndex: number;
  staffN: number;
  layerN: number;
  eventIndex: number;
}

/** Block selection: inclusive measure-index range × inclusive staff-number range. */
export interface BlockSelection {
  measureFrom: number;
  measureTo: number;
  staffFrom: number;
  staffTo: number;
}

/** One written pitch (MEI @pname/@oct, with the accidental attributes when present). */
export interface Pitch {
  pname: string;
  oct: number;
  accid?: string;
  accidGes?: string;
}

/** A pitched event (note or chord): its id and its pitches in child order. */
export interface PitchEvent {
  eventId: string;
  pitches: Pitch[];
}

export type ViewMode = "tiles" | "pages";

/** Caret and selections, in model coordinates. */
export interface EditorState {
  readonly caret: CaretPosition | null;
  /** Event selection: ordered event ids within one layer. */
  readonly selection: readonly string[];
  /** Block selection: the dragged rectangle, or null. */
  readonly block: BlockSelection | null;
  readonly view: ViewMode;
  readonly entryMode: boolean;
}

/**
 * The active document, as a snapshot. `version` bumps on every executed
 * command, undo and redo. The host publishes a new snapshot AFTER its own
 * render cycle, so a plugin cannot observe the result of its own
 * `execute` synchronously — learn it from `ctx.document.subscribe`.
 */
export interface DocumentInfo {
  /** Stable for the life of an open tab; reopening a file yields a new id. */
  id: string;
  version: number;
  measureCount: number;
  staffCount: number;
  title: string;
  /** `@midi.bpm` on the scoreDef; null when the score sets none. */
  tempo: number | null;
}

/**
 * Questions a plugin may ask the active document. Answered by the host
 * from the live model; every answer is data. With no document open the
 * answers are empty (`[]`, `null`). Grows one question at a time, when a
 * plugin being built needs it — never speculatively.
 */
export interface DocumentQueries {
  /** Pitched events of a block, one sequence per (staff, layer) voice, in measure order. Rests are skipped. */
  pitchEventsIn(block: BlockSelection): PitchEvent[][];
  /** The measure × staff rectangle an event selection covers (the editor's own rule), or null when empty. */
  blockOf(eventIds: readonly string[]): BlockSelection | null;
}
