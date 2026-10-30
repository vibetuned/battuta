/**
 * What the screencast shows, as pure functions: a key press as the keys
 * pressed ("Ctrl Shift Z"), a MIDI note as its name ("C4"), and the feed —
 * the last few entries, a key held or pressed again folded into one with a
 * count, notes struck together folded into one chord, each fading out a
 * while after it last changed.
 */
import type { KeyPress } from "@battuta/api";

export interface Entry {
  id: number;
  kind: "key" | "midi";
  /** "Ctrl Z", "Shift A", "←" — or "C4 E4 G4" for notes. */
  text: string;
  /** The action's name, for a key that ran one. */
  action: string | null;
  /** How many times in a row (a held or repeated key). */
  count: number;
  /** When it last changed, ms. */
  at: number;
}

export interface Feed {
  entries: readonly Entry[];
  next: number;
  /** The clock at the last update, for the fade. */
  now: number;
}

export const EMPTY: Feed = { entries: [], next: 1, now: 0 };
/** Entries shown at most. */
export const MAX = 6;
/** An entry stays this long after it last changed, the last part fading. */
export const LINGER = 3000;
export const FADE = 600;
/** The same keys again within this long count as a repeat. */
export const REPEAT = 1200;
/** Notes struck within this long of each other are one chord. */
export const CHORD = 80;

const MODIFIERS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "OS", "CapsLock", "Fn"]);
const NAMED: Record<string, string> = {
  " ": "Space",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  Backspace: "Backspace",
  Delete: "Del",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

/**
 * The keys of a press, modifiers first — null for a modifier alone (it is
 * shown with the key it modifies). Shift is named for letters and named
 * keys; a symbol already shows it ("!", not "Shift 1").
 *
 * macOS composes Option+key into another character (Option+B is "∫" or
 * "ß" by layout, Option+E "€" or a dead accent), so with Alt held a key
 * that did not come out as a plain letter or digit is named by its
 * physical key — as the editor's keymap reads alt bindings (`keyMatches`).
 * Only a–z is upper-cased: "ß" would become "SS".
 */
export function comboOf(p: KeyPress): string | null {
  if (MODIFIERS.has(p.key)) return null;
  const physical = p.alt && !/^[a-z0-9]$/i.test(p.key) ? /^(?:Key|Digit)([A-Z0-9])$/.exec(p.code)?.[1] : undefined;
  const single = p.key.length === 1 && p.key !== " ";
  const parts: string[] = [];
  if (p.ctrl) parts.push("Ctrl");
  if (p.alt) parts.push("Alt");
  if (p.shift && (physical !== undefined || !single || /^[a-z]$/i.test(p.key))) parts.push("Shift");
  if (p.meta) parts.push("Cmd");
  parts.push(physical ?? NAMED[p.key] ?? (/^[a-z]$/.test(p.key) ? p.key.toUpperCase() : p.key));
  return parts.join(" ");
}

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

/** A MIDI note's name, middle C as C4. */
export const noteName = (n: number): string => `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;

const push = (feed: Feed, entry: Omit<Entry, "id">): Feed => ({ entries: [...feed.entries, { ...entry, id: feed.next }].slice(-MAX), next: feed.next + 1, now: entry.at });

/** A key press: a new entry, or the last one again with its count up. */
export function addKey(feed: Feed, text: string, action: string | null, now: number): Feed {
  const last = feed.entries[feed.entries.length - 1];
  if (last && last.kind === "key" && last.text === text && last.action === action && now - last.at < REPEAT) {
    return { ...feed, entries: [...feed.entries.slice(0, -1), { ...last, count: last.count + 1, at: now }], now };
  }
  return push(feed, { kind: "key", text, action, count: 1, at: now });
}

/** A note on: a new entry, or a note of the chord just struck. */
export function addNote(feed: Feed, name: string, now: number): Feed {
  const last = feed.entries[feed.entries.length - 1];
  if (last && last.kind === "midi" && now - last.at < CHORD) return { ...feed, entries: [...feed.entries.slice(0, -1), { ...last, text: `${last.text} ${name}`, at: now }], now };
  return push(feed, { kind: "midi", text: name, action: null, count: 1, at: now });
}

/** The feed at `now`: what has lingered long enough gone. */
export function expire(feed: Feed, now: number): Feed {
  const entries = feed.entries.filter((e) => now - e.at < LINGER);
  return { ...feed, entries, now };
}

/** An entry's opacity at the feed's clock: full, then fading over its last `FADE` ms. */
export const opacityOf = (e: Entry, now: number): number => Math.max(0, Math.min(1, (LINGER - (now - e.at)) / FADE));
