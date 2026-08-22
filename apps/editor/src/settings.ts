/**
 * Persisted editor options — one JSON blob in localStorage. Small on
 * purpose: anything document-shaped belongs in the MEI, anything
 * binding-shaped in the keymap stores.
 */
import type { Layout } from "./keymap";

export interface Settings {
  layout?: Layout;
  zoom?: number;
  /** Playback tempo multiplier (1 = as encoded). */
  tempo?: number;
  /** Folder of the last opened/saved score — the next dialog starts there. */
  lastDir?: string;
  /** On-screen keyboard visible (default: shown on coarse pointers). */
  vkeys?: boolean;
}

const STORE = "battuta.settings.v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Settings) : {};
  } catch {
    return {};
  }
}

export function saveSettings(patch: Partial<Settings>): void {
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...loadSettings(), ...patch }));
  } catch {
    /* storage unavailable: options simply don't persist */
  }
}

/** First-run default: French keyboards are overwhelmingly AZERTY. */
export function detectLayout(): Layout {
  return typeof navigator !== "undefined" && /^fr/i.test(navigator.language ?? "") ? "azerty" : "qwerty";
}
