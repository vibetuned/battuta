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
  /**
   * LEGACY (0.0.2–0.0.3): on-screen keyboard visible. The panel became
   * @battuta/plugin-onscreen-keyboard in slice 4b, so the value now lives
   * in that plugin's namespace; `migrate` below moves it once. Kept
   * declared so the migration can read an old blob.
   */
  vkeys?: boolean;
  /** Playback goes to MIDI outputs instead of the built-in piano. */
  midiOut?: boolean;
  /** Semitone offset on MIDI sends and the playback-MIDI export. */
  midiTranspose?: number;
  /** Per plugin: the on/off switch from the Plugins tab and the plugin's own small settings. */
  plugins?: Record<string, PluginSettings>;
}

export interface PluginSettings {
  /** Absent means on. */
  enabled?: boolean;
  values?: Record<string, unknown>;
}

const STORE = "battuta.settings.v1";

/**
 * One-time moves of a setting that changed owner, as a DATED, EXPLICIT
 * LIST rather than a migration framework — there is one entry and it is
 * cheaper to read than a mechanism.
 *
 * A plugin cannot do this itself: it sees only its own namespace, and the
 * whole point is that the old value is somewhere else.
 *
 * - 2026-09-14 (slice 4b): `vkeys` → plugin `battuta.onscreen-keyboard`,
 *   key `open`. Pure: the migrated shape is persisted by the next
 *   `saveSettings`, so reading settings never writes.
 */
const VKEYS_OWNER = "battuta.onscreen-keyboard";

export function migrate(s: Settings): Settings {
  if (s.vkeys === undefined) return s;
  const { vkeys, ...rest } = s;
  const plugins = rest.plugins ?? {};
  const mine = plugins[VKEYS_OWNER] ?? {};
  // A value the plugin has already written wins: the user has used the
  // plugin since, and the legacy key is stale.
  if (mine.values?.["open"] !== undefined) return rest;
  return { ...rest, plugins: { ...plugins, [VKEYS_OWNER]: { ...mine, values: { ...(mine.values ?? {}), open: vkeys } } } };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? migrate(JSON.parse(raw) as Settings) : {};
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
