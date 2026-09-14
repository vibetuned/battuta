/**
 * Lanes — a typed text lane at the caret. The host owns the MECHANISM
 * (one buffer, one modal key protocol, the floating editor, the status-bar
 * entry, the advance over the caret path); a lane contributes only what
 * differs between lanes: what it attaches to, how the caret advances, which
 * keys commit, which characters it admits, what "complete" and
 * "suggestions" mean, how to read the current value and how to turn the
 * buffer into ONE command message.
 *
 * Read off the two lanes the editor had before the point existed
 * (harmony's chord symbols and Roman numerals, and lyrics), so each field
 * exists because one of them needed it: `accepts` / `transform` /
 * `complete` / `suggest` are harmony's closed grammar, `advance: "note"`
 * and `-` among the advance keys are lyrics'. The host knows nothing about
 * the TEXT of any lane — no grammar, no MEI shape.
 *
 * The protocol, for every open lane:
 *   Escape        commit, then leave the lane
 *   an advance key   commit, then move the caret on (`advance` says how far)
 *   ← →           commit, then step one event
 *   Backspace     delete the last character
 *   Tab           take the first suggestion (only when the lane suggests)
 *   a character   admitted when `accepts` says so (or always, when absent),
 *                 mapped by `transform` first; never with ctrl/meta/alt
 * A commit that returns null changes nothing and the key proceeds; one that
 * returns `{ refuse }` shows the reason and the key stops there.
 */
import type { Disposable } from "./disposable.js";
import type { CommandMessage } from "./messages.js";

export type LanePlace = "above" | "below";

/**
 * A lane DECLARED in the manifest (`contributes.lanes`): the host lists it
 * in the status bar before the plugin's code loads, and picking it fires
 * `onLane:<id>` — the plugin then registers the spec and the lane opens.
 * Lane ids are global, like command ids: `<pluginId>.<name>`.
 */
export interface LaneContribution {
  id: string;
  /** The status-bar option, e.g. "lyrics (verse 1, l)". */
  label: string;
  /** The short name shown while the lane is open and in its notices, e.g. "lyrics". */
  name: string;
  /** Prefix of the floating editor, e.g. "♪". */
  glyph?: string;
  /** Above or below the staff: where the floating editor sits. */
  place: LanePlace;
}

/** What the host hands `commit`: everything a lane may need to build its message. */
export interface LaneCommit {
  /** The event under the caret. */
  eventId: string;
  buffer: string;
  /** The key that committed: "Escape", an advance key, "ArrowLeft" / "ArrowRight". */
  key: string;
  /**
   * The previous event of the lane's kind along the caret path (a NOTE
   * for `advance: "note"`, any event otherwise), or null at the start.
   * Lyrics read the previous syllable's continuation off it.
   */
  prevEventId: string | null;
}

/** Nothing to write (null), a message to execute, or a refusal the host shows as a notice. */
export type LaneCommitResult = CommandMessage | null | { refuse: string };

export interface LaneSpec extends LaneContribution {
  /**
   * What the lane's value hangs on. A commit on anything else is refused
   * with a notice — except an EMPTY buffer, which the caret may carry past
   * a rest without complaint.
   */
  attachesTo: "note" | "event";
  /** Where an advance key moves the caret: the next event, or the next NOTE with rests skipped. */
  advance: "event" | "note";
  /** Keys that commit and advance, e.g. ["Enter"] or [" ", "Enter", "-"]. */
  advanceOn: readonly string[];
  /** The notice shown when the lane opens (how to use it). */
  hint?: string;
  /** Which single characters may extend the buffer. Absent: any printable character. */
  accepts?(ch: string): boolean;
  /** Map a typed character before it is admitted (e.g. "o" → "°"). */
  transform?(ch: string): string;
  /** Is the buffer a complete value? Drives the editor's valid/invalid colour; absent: always complete. */
  complete?(buffer: string): boolean;
  /** Completions for the buffer, shown beside it; Tab takes the first. */
  suggest?(buffer: string): readonly string[];
  /** The current value at an event, as the buffer should show it ("" when none). */
  read(eventId: string): string;
  commit(c: LaneCommit): LaneCommitResult;
}

export interface LanesService {
  /**
   * Register the spec for a lane this plugin DECLARED in its manifest.
   * Disposed with the plugin (or by hand): the declared face returns to the
   * status bar and the lane, if open, closes.
   */
  register(spec: LaneSpec): Disposable;
  /**
   * Open a lane by id at the caret — for a plugin's own key. False when the
   * lane is unknown or there is no caret. Opening leaves entry mode, as the
   * status-bar select does; a key that must NOT do that in entry mode
   * declines on `ctx.editor.get().entryMode` first.
   */
  open(id: string): boolean;
}
