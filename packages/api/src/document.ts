/**
 * What a plugin may know about the document — as DATA. Every type here
 * is plain JSON: no classes, no live objects, no core imports. That is
 * what keeps the API message-passing-friendly (a worker host or
 * third-party loading stays a deferral, not a rewrite) and what makes
 * "everything through @battuta/api" true rather than aspirational: there
 * is nothing of the document model here to reach into.

 */

/**
 * Core owns the document's data types; the api RE-EXPORTS exactly these —
 * plain JSON, no model, no class — and nothing else of `@battuta/core`.
 * Adding a name here is a contract change (the surface report inlines
 * the re-exported shapes, so a change to one of them in core shows up as
 * a surface change and needs a version bump); a plugin still imports only
 * `@battuta/api`, and the boundary test keeps it that way.
 */
import type { CaretPosition, BlockSelection, Pitch, PitchEvent, SylValue, HarmKind, NotationFacts } from "@battuta/core";
export type { CaretPosition, BlockSelection, Pitch, PitchEvent, SylValue, HarmKind, NotationFacts, NoteMark } from "@battuta/core";
import type { Timemap } from "./render.js";

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
  /**
   * The document's NAME as the tab shows it — the file's base name without
   * its extension, or what the user was given for an untitled score. Not
   * the MEI title (that is `title`, often empty). For naming what you
   * derive from the document: an export, a sidecar. Added 2026-09-15 for
   * the playback-MIDI export (`<name>-playback.mid`) and slice 9's folder
   * view.
   */
  name: string;
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
  /** The verse-1 syllable of a note or chord (a chord's sits on its first note), or null when it has none. */
  lyricAt(eventId: string): SylValue | null;
  /** The harmony text of one kind anchored at an event, "" when none. */
  harmAt(eventId: string, kind: HarmKind): string;
  /**
   * Would the document accept this text as a harmony of this kind? Core
   * owns the grammar that decides, because more than one plugin may write
   * a harmony (the lane today, a generator tomorrow) and every writer must
   * be refused the same text; `core.setHarm` refuses what fails it. Ask
   * here — a lane's `complete`, a generator's filter — never copy it.
   * Needs no document: a grammar question.
   */
  harmValid(kind: HarmKind, text: string): boolean;
  /**
   * Verovio's timemap for the document, of the expanded form — a render
   * service, read-only (see render.ts). Null with no document open;
   * rejects with the render error. A player builds its own performance
   * from this and `notation()`.
   */
  timemap(): Promise<Timemap | null>;
  /** The notation facts a performance interprets: which note ties into which, which marks a note carries. Empty without a document. */
  notation(): NotationFacts;
}
