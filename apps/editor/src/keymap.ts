/**
 * The keymap: every single-key editing action, rebindable and persisted.
 * Bindings match on e.key characters (layout-carrying, per the AZERTY
 * lessons: characters travel with the layout, physical codes do not),
 * plus explicit alt/shift flags where the character does not imply them.
 * Physical-code bindings (durations, fingering, voltas) and system
 * chords (ctrl+…) are listed for the editor but locked.
 */
export interface KeyBinding {
  /** e.key values that trigger the action (letters carry their case). */
  keys: string[];
  /** When set, e.shiftKey must equal it (for non-letter keys). */
  shift?: boolean;
  /** When set, e.altKey must equal it; unset means alt must be OFF. */
  alt?: boolean;
  label: string;
  group: string;
  /** Context note shown in the editor. */
  when?: string;
  /** Shown in the editor but not rebindable (physical/system binding). */
  locked?: boolean;
}

export const DEFAULT_KEYMAP: Record<string, KeyBinding> = {
  inputMode: { keys: ["i"], label: "toggle note input", group: "entry" },
  rest: { keys: ["r"], label: "enter a rest", group: "entry", when: "input mode" },
  durations: { keys: ["1–7"], label: "duration (7=whole … 1=64th)", group: "entry", when: "input mode · physical digit row/numpad", locked: true },
  pitches: { keys: ["a–g"], label: "enter pitch", group: "entry", when: "input mode · shift+A–G adds chord notes", locked: true },
  dot: { keys: [".", ":"], shift: false, label: "augmentation dot", group: "entry" },
  sharp: { keys: ["s"], label: "sharp ♯", group: "accidentals" },
  flat: { keys: ["v", "f"], label: "flat ♭", group: "accidentals" },
  natural: { keys: ["n"], label: "natural ♮", group: "accidentals" },
  slurDoubleSharp: { keys: ["S"], label: "slur (selection) / double sharp 𝄪", group: "accidentals" },
  tie: { keys: ["t"], label: "tie · tie chain (selection)", group: "marks" },
  staccato: { keys: [","], label: "staccato", group: "marks" },
  accent: { keys: [";"], label: "accent", group: "marks" },
  marcato: { keys: [".", ":", ">"], shift: true, label: "marcato", group: "marks" },
  staccatissimo: { keys: ["<", "?"], label: "staccatissimo", group: "marks" },
  fermata: { keys: ["h"], label: "fermata", group: "marks" },
  coda: { keys: ["o"], label: "coda → segno → fine → D.S. → D.C.", group: "marks" },
  ornament: { keys: ["w"], label: "ornament cycle (arpeggio/tremolo/trill/mordent)", group: "marks" },
  dynamics: { keys: ["p"], label: "dynamics cycle · hairpin (selection)", group: "marks" },
  pedal: { keys: ["P"], label: "pedal (selection)", group: "marks" },
  simile: { keys: ["'", "ù"], label: "simile slash (one beat)", group: "repeats" },
  measureRepeat: { keys: ['"', "%"], label: "measure repeat % → %%", group: "repeats" },
  repeatBarlines: { keys: ["r"], label: "repeat barlines 𝄆 𝄇", group: "repeats", when: "block selection" },
  voltas: { keys: ["⇧1–9"], label: "volta number toggle", group: "repeats", when: "block selection · physical digits", locked: true },
  merge: { keys: ["m"], label: "merge with next · grace cycle (2 pitches)", group: "rhythm" },
  split: { keys: ["x"], label: "split in half", group: "rhythm" },
  tuplet: { keys: ["T"], label: "tuplet 3:2 / 6:4 (selection)", group: "rhythm" },
  beam: { keys: ["b"], alt: true, label: "auto-beam measure", group: "rhythm" },
  fingering: { keys: ["⌥1–5"], label: "fingering (shift adds)", group: "marks", locked: true },
  durationStep: { keys: ["⌥←/→"], label: "shorten / lengthen duration", group: "rhythm", locked: true },
  navigation: { keys: ["←→↑↓"], label: "caret: events / voices / staves / lines", group: "system", locked: true },
  structural: { keys: ["⊞+ ⊞− ⊞*"], label: "insert / delete / duplicate measure (numpad)", group: "system", locked: true },
  system: { keys: ["⌃s ⌃o ⌃z ⌃y ⌃c ⌃v ⌃± ⌃0"], label: "save / open / undo / redo / copy / paste / zoom", group: "system", locked: true },
};

const STORE = "battuta.keymap.v1";

export type Keymap = Record<string, KeyBinding>;

export function loadKeymap(): Keymap {
  const map: Keymap = Object.fromEntries(Object.entries(DEFAULT_KEYMAP).map(([k, v]) => [k, { ...v, keys: [...v.keys] }]));
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const overrides = JSON.parse(raw) as Record<string, { keys: string[]; shift?: boolean; alt?: boolean }>;
      for (const [id, o] of Object.entries(overrides)) {
        if (map[id] && !map[id].locked && Array.isArray(o.keys)) {
          map[id] = { ...map[id], keys: o.keys, shift: o.shift, alt: o.alt };
        }
      }
    }
  } catch {
    /* corrupted storage: fall back to defaults */
  }
  return map;
}

export function saveKeymapOverride(id: string, binding: Pick<KeyBinding, "keys" | "shift" | "alt">): void {
  try {
    const raw = localStorage.getItem(STORE);
    const overrides = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    overrides[id] = binding;
    localStorage.setItem(STORE, JSON.stringify(overrides));
  } catch {
    /* storage unavailable: the rebind still applies for this session */
  }
}

export function clearKeymapOverrides(): void {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* ignore */
  }
}

/** Does this event trigger the binding? (mod/ctrl guards stay at call sites) */
export function keyMatches(b: KeyBinding | undefined, e: { key: string; shiftKey: boolean; altKey: boolean }): boolean {
  if (!b || b.locked) return false;
  if (b.alt ? !e.altKey : e.altKey) return false;
  if (b.shift !== undefined && e.shiftKey !== b.shift) return false;
  return b.keys.includes(e.key);
}

/** Human-readable key list for the editor. */
export function bindingText(b: KeyBinding): string {
  const mods = `${b.alt ? "alt+" : ""}${b.shift ? "shift+" : ""}`;
  return b.keys.map((k) => `${mods}${k}`).join(" · ");
}
