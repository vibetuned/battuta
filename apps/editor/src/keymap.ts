/**
 * The keymap: every single-key editing action, rebindable and persisted.
 * Bindings match on e.key characters (layout-carrying, per the AZERTY
 * lessons: characters travel with the layout, physical codes do not),
 * plus explicit alt/shift flags where the character does not imply them.
 * Physical-code bindings (durations, fingering, voltas) and system
 * chords (ctrl+…) are listed for the editor but locked.
 *
 * QWERTY and AZERTY get SEPARATE default maps (toggle in the shortcut
 * editor): a merged map double-books keys — e.g. QWERTY's simile "'" is
 * AZERTY's unshifted digit-4 key, so in input mode it collided with the
 * duration row. Only the punctuation rows differ; letters and physical
 * bindings are layout-independent.
 */
export type Layout = "qwerty" | "azerty";

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
  /** Set on bindings a plugin contributed (its id); the action id is the command id. */
  plugin?: string;
}

export const defaultKeymap = (layout: Layout): Record<string, KeyBinding> => {
  const az = layout === "azerty";
  return {
    inputMode: { keys: ["i"], label: "toggle note input (also Insert)", group: "entry" },
    rest: { keys: ["r"], label: "enter a rest (also numpad 0)", group: "entry", when: "input mode" },
    durations: { keys: ["1–7"], label: "duration (7=whole … 1=64th)", group: "entry", when: "input mode · physical digit row/numpad", locked: true },
    pitches: { keys: ["a–g"], label: "enter pitch", group: "entry", when: "input mode · shift+A–G adds chord notes", locked: true },
    // AZERTY has no unshifted "." — ":" is; the bare "." stays for the numpad.
    dot: { keys: az ? [":", "."] : ["."], shift: false, label: "augmentation dot", group: "entry" },
    sharp: { keys: ["s"], label: "sharp ♯", group: "accidentals" },
    flat: { keys: ["v", "f"], label: "flat ♭", group: "accidentals" },
    natural: { keys: ["n"], label: "natural ♮", group: "accidentals" },
    slurDoubleSharp: { keys: ["S"], label: "slur (selection) / double sharp 𝄪", group: "accidentals" },
    tie: { keys: ["t"], label: "tie · tie chain (selection)", group: "marks" },
    staccato: { keys: [","], label: "staccato", group: "marks" },
    accent: { keys: [";"], label: "accent", group: "marks" },
    // marcato = the accent key shifted: shift+; is "." on AZERTY, ":" on QWERTY.
    marcato: { keys: az ? ["."] : [":", ">"], shift: true, label: "marcato", group: "marks" },
    // staccatissimo = the staccato key shifted: shift+, is "?" on AZERTY, "<" on QWERTY.
    staccatissimo: { keys: az ? ["?"] : ["<"], label: "staccatissimo", group: "marks" },
    fermata: { keys: ["h"], label: "fermata", group: "marks" },
    coda: { keys: ["o"], label: "coda → To Coda → segno → fine → D.S. → D.C.", group: "marks" },
    ornament: { keys: ["w"], label: "ornament cycle (arpeggio/tremolo/trill/mordent)", group: "marks" },
    dynamics: { keys: ["p"], label: "dynamics cycle · hairpin (selection)", group: "marks" },
    intensity: { keys: ["I"], label: "attack intensity: sf → sfz → rinf → rfz", group: "marks" },
    pedal: { keys: ["P"], label: "pedal (selection)", group: "marks" },
    simile: { keys: az ? ["ù"] : ["'"], label: "simile slash (one beat)", group: "repeats" },
    measureRepeat: { keys: az ? ["%"] : ['"'], label: "measure repeat % → %%", group: "repeats" },
    repeatBarlines: { keys: ["r"], alt: true, label: "repeat barlines 𝄆 𝄇 (block) · end repeat 𝄇 at the caret measure", group: "repeats", when: "works in input mode too" },
    staffGroup: { keys: ["G"], label: "staff group cycle: none → brace → bracket", group: "repeats", when: "block selection spanning staves" },
    lyrics: { keys: ["l"], label: "lyrics lane: type at the caret, space/enter advances, - hyphenates", group: "entry" },
    contextBar: { keys: ["F6"], label: "focus the context bar (←/→ selects · ↑/↓ change · esc back)", group: "system" },
    voltas: { keys: ["⇧1–9"], label: "volta number toggle", group: "repeats", when: "block selection · physical digits", locked: true },
    merge: { keys: ["m"], label: "merge with next · grace cycle (2 pitches)", group: "rhythm" },
    split: { keys: ["x"], label: "split in half", group: "rhythm" },
    tuplet: { keys: ["T"], label: "tuplet 3:2 / 6:4 (selection)", group: "rhythm" },
    reflect: { keys: ["R"], label: "reflection cycle: inversion → retrograde → retr. inversion → back", group: "rhythm", when: "block selection" },
    beam: { keys: ["b"], alt: true, label: "auto-beam measure", group: "rhythm" },
    fingering: { keys: ["⌥1–5"], label: "fingering (shift adds)", group: "marks", locked: true },
    fingerChange: { keys: ["⌥6–0"], label: "finger change 3-1 (6–0 = new finger 1–5)", group: "marks", locked: true },
    durationStep: { keys: ["⌥←/→"], label: "shorten / lengthen duration", group: "rhythm", locked: true },
    navigation: { keys: ["←→↑↓"], label: "caret: events / voices / staves / lines", group: "system", locked: true },
    rowNavigation: { keys: ["Home End PgUp PgDn"], label: "row start / end · previous / next row", group: "system", locked: true },
    structural: { keys: ["⊞+ ⊞− ⊞*"], label: "insert / delete / duplicate measure (numpad)", group: "system", locked: true },
    system: { keys: ["⌃s ⌃o ⌃z ⌃y ⌃c ⌃v ⌃± ⌃0"], label: "save / open / undo / redo / copy / paste / zoom", group: "system", locked: true },
  };
};

const overrideStore = (layout: Layout) => `battuta.keymap.v1.${layout}`;

export type Keymap = Record<string, KeyBinding>;

export type KeymapOverride = { keys: string[]; shift?: boolean; alt?: boolean };

/** The user's rebinds for a layout, keyed by action id (core or plugin command). Empty when storage is unavailable or corrupt. */
export function readKeymapOverrides(layout: Layout): Record<string, KeymapOverride> {
  try {
    const raw = localStorage.getItem(overrideStore(layout));
    return raw ? (JSON.parse(raw) as Record<string, KeymapOverride>) : {};
  } catch {
    return {}; /* corrupted or unavailable storage: defaults */
  }
}

export function loadKeymap(layout: Layout): Keymap {
  const map: Keymap = Object.fromEntries(Object.entries(defaultKeymap(layout)).map(([k, v]) => [k, { ...v, keys: [...v.keys] }]));
  for (const [id, o] of Object.entries(readKeymapOverrides(layout))) {
    if (map[id] && !map[id].locked && Array.isArray(o.keys)) {
      map[id] = { ...map[id], keys: o.keys, shift: o.shift, alt: o.alt };
    }
  }
  return map;
}

export function saveKeymapOverride(layout: Layout, id: string, binding: Pick<KeyBinding, "keys" | "shift" | "alt">): void {
  try {
    const raw = localStorage.getItem(overrideStore(layout));
    const overrides = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    overrides[id] = binding;
    localStorage.setItem(overrideStore(layout), JSON.stringify(overrides));
  } catch {
    /* storage unavailable: the rebind still applies for this session */
  }
}

export function clearKeymapOverrides(layout: Layout): void {
  try {
    localStorage.removeItem(overrideStore(layout));
  } catch {
    /* ignore */
  }
}

/** Does this event trigger the binding? (mod/ctrl guards stay at call sites) */
export function keyMatches(b: KeyBinding | undefined, e: { key: string; shiftKey: boolean; altKey: boolean; code?: string }): boolean {
  if (!b || b.locked) return false;
  if (b.alt ? !e.altKey : e.altKey) return false;
  if (b.shift !== undefined && e.shiftKey !== b.shift) return false;
  if (b.keys.includes(e.key)) return true;
  // macOS composes Option+letter into a symbol (alt+r -> "®", alt+b ->
  // "∫"), so alt bindings on plain letters ALSO match the physical key.
  return b.alt === true && e.code !== undefined && b.keys.some((k) => /^[a-z]$/.test(k) && e.code === `Key${k.toUpperCase()}`);
}

/** Human-readable key list for the editor. */
export function bindingText(b: KeyBinding): string {
  const mods = `${b.alt ? "alt+" : ""}${b.shift ? "shift+" : ""}`;
  return b.keys.map((k) => `${mods}${k}`).join(" · ");
}
