/**
 * Actions by id — the door an input surface uses instead of forging key
 * events. The host's key dispatcher is a table `actionId → handler`;
 * a physical key press selects an id through the keymap (rebindable
 * actions) or a fixed physical binding (the locked ones), and
 * `ctx.actions.run(id)` enters the SAME table at the same point, under the
 * same state conditions (no document, a lane open, a modal picker up →
 * nothing runs). A plugin therefore cannot do anything the host has not
 * named, and the edits it causes are ordinary core commands.
 *
 * Rebindable ids are the keymap's (`tie`, `dot`, `dynamics`, …, and every
 * plugin command). The locked physical and system keys have fixed ids:
 *
 *   undo, redo · zoom.in, zoom.out, zoom.reset · file.save, file.saveAs,
 *   file.open · clipboard.copy, clipboard.paste · measure.insert,
 *   measure.delete, measure.duplicate · entry.toggle · volta.1 … volta.9 ·
 *   finger.1 … finger.5, finger.add.1 … finger.add.5, fingerChange.1 …
 *   fingerChange.5 · duration.1 … duration.7 (the digit the user types:
 *   7 = whole … 1 = 64th) · pitch.a … pitch.g · chord.a … chord.g ·
 *   dynamic.f, dynamic.p · duration.shorter, duration.longer · nav.left,
 *   nav.right, nav.up, nav.down, nav.home, nav.end, nav.pageUp,
 *   nav.pageDown · select.left, select.right · transpose.up,
 *   transpose.down, transpose.octaveUp, transpose.octaveDown ·
 *   edit.delete, edit.backspace, edit.escape
 *
 * `ids` is the live list: every id `run` knows — the host's rules and
 * every enabled plugin's commands — as a Store, so a projection (the
 * on-screen keyboard) re-renders when a plugin is turned on or off or a
 * document opens, instead of trusting this comment or polling.
 */
import type { Store } from "./context.js";

/** One keymap entry as data: what the shortcut editor and the on-screen keyboard render. */
export interface KeymapEntry {
  /** Action id — a core id (`tie`) or a plugin's command id. */
  id: string;
  label: string;
  group: string;
  /** Context note, e.g. "block selection". */
  when?: string;
  /** e.key values that trigger it (letters carry their case); display text for locked rows. */
  keys: readonly string[];
  shift?: boolean;
  alt?: boolean;
  /** Listed for the user but not rebindable (a physical-code or ctrl-chord binding). */
  locked: boolean;
  /** Set on entries a plugin contributed (its id). */
  plugin?: string;
}

export interface ActionsService {
  /**
   * Run an action by id through the host's own dispatch table. True when
   * it ran; false when the id is unknown, or the state does not allow it
   * (no caret, a lane or picker owns the keyboard, the action's own
   * condition fails) — exactly when the key would have done nothing. A
   * plugin's command id runs through the registry, after the same gates,
   * as its key would.
   */
  run(id: string): boolean;
  /** Every id `run` knows — the host's, then every enabled plugin's commands — republished on every change. */
  readonly ids: Store<readonly string[]>;
}
