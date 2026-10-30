/**
 * Key presses as data (1.3.4, for the screencast keys plugin): every key
 * the editor's own key handler receives — the physical keyboard, not the
 * on-screen one, and never a key typed into a text field — with its
 * modifiers and the action it ran, so a plugin can show what was pressed
 * without listening to the page itself.
 */
import type { Disposable } from "./disposable.js";

export interface KeyPress {
  /** `KeyboardEvent.key`: what the key types on the user's layout — "a", "A", "4", "ArrowLeft", "Escape", " " … */
  key: string;
  /** `KeyboardEvent.code`: the physical key — "KeyA", "Digit4" … */
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** The action the press ran — a keymap id (`tie`, `undo`, a plugin's command); its label is in `ctx.keymap` — or null when it ran none. */
  action: string | null;
}

export interface KeysService {
  /** Every key press, after the editor handled it; the disposable unsubscribes. */
  on(listener: (press: KeyPress) => void): Disposable;
}
