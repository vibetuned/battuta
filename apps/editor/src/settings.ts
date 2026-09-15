/**
 * Persisted editor options — one JSON blob in localStorage. Small on
 * purpose: anything document-shaped belongs in the MEI, anything
 * binding-shaped in the keymap stores.
 */
import type { Layout } from "./keymap";

export interface Settings {
  layout?: Layout;
  zoom?: number;
  /** Folder of the last opened/saved score — the next dialog starts there. */
  lastDir?: string;
  /**
   * LEGACY (0.0.2–0.0.3): on-screen keyboard visible. The panel became
   * @battuta/plugin-onscreen-keyboard in slice 4b, so the value now lives
   * in that plugin's namespace; `migrate` below moves it once. Kept
   * declared so the migration can read an old blob.
   */
  vkeys?: boolean;
  /**
   * LEGACY (0.0.2–0.0.3): the page-view player's three choices — the speed
   * multiplier (1 = as encoded), playback to the MIDI outputs instead of
   * the built-in piano, and the semitone offset on the MIDI sends and the
   * playback-MIDI export. The player became @battuta/plugin-playback in
   * slice 7b; `migrate` moves all three into its namespace. Kept declared
   * so the migration can read an old blob.
   */
  tempo?: number;
  midiOut?: boolean;
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
 * LIST rather than a migration framework — there are two entries and they
 * are cheaper to read than a mechanism.
 *
 * A plugin cannot do this itself: it sees only its own namespace, and the
 * whole point is that the old value is somewhere else.
 *
 * - 2026-09-14 (slice 4b): `vkeys` → plugin `battuta.onscreen-keyboard`,
 *   key `open`.
 * - 2026-09-15 (slice 7b): `tempo`, `midiOut`, `midiTranspose` → plugin
 *   `battuta.playback`, under the same three key names.
 *
 * Both are pure: the migrated shape is persisted by the next
 * `saveSettings`, so reading settings never writes. A value the plugin has
 * already written wins in both — the user has used the plugin since, and
 * the legacy key is stale.
 */
const VKEYS_OWNER = "battuta.onscreen-keyboard";
const PLAYER_OWNER = "battuta.playback";
/** The player's three keys, spelled the same on both sides of the move. */
const PLAYER_KEYS = ["tempo", "midiOut", "midiTranspose"] as const;

/** 4b: the on-screen keyboard's `vkeys`, which also changed NAME (→ `open`). */
function moveVkeys(s: Settings): Settings {
  if (s.vkeys === undefined) return s;
  const { vkeys, ...rest } = s;
  const plugins = rest.plugins ?? {};
  const mine = plugins[VKEYS_OWNER] ?? {};
  if (mine.values?.["open"] !== undefined) return rest;
  return { ...rest, plugins: { ...plugins, [VKEYS_OWNER]: { ...mine, values: { ...(mine.values ?? {}), open: vkeys } } } };
}

/** 7b: the player's speed, MIDI-out and transpose, keeping their names. */
function movePlayer(s: Settings): Settings {
  const moving = PLAYER_KEYS.filter((k) => s[k] !== undefined);
  if (moving.length === 0) return s;
  const { tempo, midiOut, midiTranspose, ...rest } = s;
  const legacy: Record<string, unknown> = { tempo, midiOut, midiTranspose };
  const plugins = rest.plugins ?? {};
  const mine = plugins[PLAYER_OWNER] ?? {};
  const values = { ...(mine.values ?? {}) };
  for (const key of moving) if (values[key] === undefined) values[key] = legacy[key];
  return { ...rest, plugins: { ...plugins, [PLAYER_OWNER]: { ...mine, values } } };
}

export function migrate(s: Settings): Settings {
  return movePlayer(moveVkeys(s));
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
