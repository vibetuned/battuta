/**
 * The virtual keyboard's key model: which buttons the on-screen panel
 * shows and the exact KeyboardEvent fields each one synthesizes. Kept
 * apart from the component so tests can hold it against the keymap:
 *
 *  - every action in defaultKeymap() must be reachable here — generated
 *    from the live keymap when the binding is rebindable, hand-listed in
 *    PHYSICAL_KEYS when it matches on physical codes, or covered by the
 *    piano (PIANO_COVERS). Adding a keymap action without representing
 *    it fails the coverage test.
 *  - every synthesized event must actually trigger its binding
 *    (round-trip test through keyMatches).
 */
import type { Keymap, Layout } from "./keymap";

export interface VirtualKeySpec {
  /** The keymap action this button serves, or one of EXTRA_IDS. */
  id: string;
  /** Button caption — a touch key, so short. */
  label: string;
  /** KeyboardEvent.key to synthesize. */
  key: string;
  /** KeyboardEvent.code, for bindings matched by physical position. */
  code?: string;
  /** Modifier flags baked into the button (latches OR on top). */
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
  /** Panel group (keymap groups plus "nav"). */
  group: string;
  /** Full description (title attribute / long-press hint). */
  title: string;
}

/** Keymap actions the piano itself covers — no button needed. */
export const PIANO_COVERS: readonly string[] = ["pitches"];

/**
 * One two-row digit pad (1–5 over 6–0) serves four actions, picked by
 * the latched modifier: plain 1–7 = duration (input mode), shift =
 * volta (block selection), alt 1–5 = fingering, alt 6–0 = finger
 * change. Every button carries e.key AND the physical Digit code, so
 * each of those handler paths sees exactly what it matches on.
 */
export const DIGIT_PAD_ID = "digitPad";
export const DIGIT_PAD_COVERS: readonly string[] = ["durations", "voltas", "fingering", "fingerChange"];

/** alt+6–0 substitutes to this new finger (the handler's mapping). */
const NEW_FINGER: Record<string, string> = { "6": "1", "7": "2", "8": "3", "9": "4", "0": "5" };

/**
 * Actions reached by LATCHING a modifier on another button instead of
 * having one of their own — mirrors the physical pairs the keymap
 * documents (marcato IS the accent key shifted, etc.). `keys` restricts
 * which of the base's buttons carry the variant; `labels` names them
 * per key. The variants test round-trips every entry in both layouts.
 */
export interface ModVariant {
  /** The base button's id. */
  of: string;
  mods: { shift?: boolean; alt?: boolean };
  /** Only these base keys carry the variant (default: all). */
  keys?: string[];
  /** Label per base key while the latch is on (default: the variant's SHORT). */
  labels?: Record<string, string>;
}

export const MOD_VARIANTS: Record<string, ModVariant> = {
  slurDoubleSharp: { of: "sharp", mods: { shift: true } },
  intensity: { of: "inputMode", mods: { shift: true } },
  tuplet: { of: "tie", mods: { shift: true } },
  reflect: { of: "rest", mods: { shift: true } },
  pedal: { of: "dynamics", mods: { shift: true } },
  staccatissimo: { of: "staccato", mods: { shift: true } },
  marcato: { of: "accent", mods: { shift: true } },
  measureRepeat: { of: "simile", mods: { shift: true } },
  durationStep: { of: "navigation", mods: { alt: true }, keys: ["ArrowLeft", "ArrowRight"], labels: { ArrowLeft: "dur −", ArrowRight: "dur +" } },
};

/**
 * What SHIFT does to a non-letter key, per layout — the panel synthesizes
 * the character a real shifted press would produce (letters uppercase in
 * eventForSpec). Only keys that base buttons actually use are listed.
 */
const SHIFTED: Record<Layout, Record<string, string>> = {
  qwerty: { ",": "<", ".": ">", ";": ":", "'": '"' },
  azerty: { ",": "?", ";": ".", ":": "/", "ù": "%" },
};

/** Panel buttons for keys the app handles OUTSIDE the keymap. */
export const EXTRA_IDS: readonly string[] = ["delete", "escape", "enter"];

/** Short captions for generated buttons; fallback is the bound key. */
const SHORT: Record<string, string> = {
  inputMode: "input",
  rest: "rest",
  dot: "dot",
  sharp: "♯",
  flat: "♭",
  natural: "♮",
  slurDoubleSharp: "slur 𝄪",
  tie: "tie",
  staccato: "stacc ·",
  accent: "acc >",
  marcato: "marc ^",
  staccatissimo: "stacc ▾",
  fermata: "ferm 𝄐",
  coda: "coda",
  ornament: "ornam",
  dynamics: "dyn",
  intensity: "sfz",
  pedal: "ped",
  simile: "simile",
  measureRepeat: "%",
  repeatBarlines: "𝄆 𝄇",
  merge: "merge",
  split: "split",
  tuplet: "tuplet",
  reflect: "reflect",
  beam: "beam",
};

/**
 * One button per rebindable keymap action, synthesizing the FIRST bound
 * key — rebinds and brand-new actions appear without touching the panel.
 */
export function generatedKeys(keymap: Keymap): VirtualKeySpec[] {
  return Object.entries(keymap)
    .filter(([id, b]) => !b.locked && b.keys[0] !== undefined && !MOD_VARIANTS[id])
    .map(([id, b]) => ({
      id,
      label: SHORT[id] ?? b.keys[0]!,
      key: b.keys[0]!,
      ...(b.shift !== undefined && { shift: b.shift }),
      ...(b.alt !== undefined && { alt: b.alt }),
      group: b.group,
      title: b.label,
    }));
}

/**
 * Buttons for the locked bindings (physical digit row, arrows, numpad,
 * ctrl chords) and the EXTRA_IDS keys. Hand-written because these match
 * on e.code or live outside the keymap — the coverage test keeps this
 * list honest when the keymap grows.
 */
export function physicalKeys(): VirtualKeySpec[] {
  const specs: VirtualKeySpec[] = [];
  // Digit pad — the grid flows column-first over two rows, so this order
  // renders as 1 2 3 4 5 over 6 7 8 9 0. Labels carry the duration glyph
  // (7 = whole … 1 = 64th) since that is what a plain press does.
  const DUR_GLYPH: Record<string, string> = { "7": "𝅝", "6": "𝅗𝅥", "5": "♩", "4": "♪", "3": "𝅘𝅥𝅯", "2": "𝅘𝅥𝅰", "1": "𝅘𝅥𝅱" };
  for (const digit of ["1", "6", "2", "7", "3", "8", "4", "9", "5", "0"]) {
    const glyph = DUR_GLYPH[digit];
    const alt = NEW_FINGER[digit] ? `finger change →${NEW_FINGER[digit]}` : `fingering ${digit} (add: shift too)`;
    specs.push({
      id: DIGIT_PAD_ID,
      label: glyph ? `${digit} ${glyph}` : digit,
      key: digit,
      code: `Digit${digit}`,
      group: "digits",
      title: `${glyph ? `duration ${glyph} (input mode)` : "digit"} · shift: volta ${digit} · alt: ${alt}`,
    });
  }
  specs.push(
    // Nav is a 2-row/column-flow grid: this order renders as a D-pad —
    // (home, ←) (↑, ↓) (end, →) then the paging column.
    { id: "rowNavigation", label: "⇤", key: "Home", group: "nav", title: "row start" },
    { id: "navigation", label: "←", key: "ArrowLeft", group: "nav", title: "previous event (latch shift to select)" },
    { id: "navigation", label: "↑", key: "ArrowUp", group: "nav", title: "transpose up / voice up (latch shift for octave)" },
    { id: "navigation", label: "↓", key: "ArrowDown", group: "nav", title: "transpose down / voice down (latch shift for octave)" },
    { id: "rowNavigation", label: "⇥", key: "End", group: "nav", title: "row end" },
    { id: "navigation", label: "→", key: "ArrowRight", group: "nav", title: "next event (latch shift to select)" },
    { id: "rowNavigation", label: "pg↑", key: "PageUp", group: "nav", title: "previous row" },
    { id: "rowNavigation", label: "pg↓", key: "PageDown", group: "nav", title: "next row" },
    { id: "structural", label: "+m", key: "+", code: "NumpadAdd", group: "system", title: "insert measure" },
    { id: "structural", label: "−m", key: "-", code: "NumpadSubtract", group: "system", title: "delete measure" },
    { id: "structural", label: "⧉m", key: "*", code: "NumpadMultiply", group: "system", title: "duplicate measure" },
    { id: "system", label: "save", key: "s", ctrl: true, group: "system", title: "save (latch shift for save as)" },
    { id: "system", label: "open", key: "o", ctrl: true, group: "system", title: "open a score" },
    { id: "system", label: "undo", key: "z", ctrl: true, group: "system", title: "undo" },
    { id: "system", label: "redo", key: "y", ctrl: true, group: "system", title: "redo" },
    { id: "system", label: "copy", key: "c", ctrl: true, group: "system", title: "copy block/measure" },
    { id: "system", label: "paste", key: "v", ctrl: true, group: "system", title: "paste (replace measures)" },
    { id: "system", label: "z+", key: "+", ctrl: true, group: "system", title: "zoom in" },
    { id: "system", label: "z−", key: "-", ctrl: true, group: "system", title: "zoom out" },
    { id: "system", label: "z0", key: "0", ctrl: true, group: "system", title: "reset zoom" },
    { id: "delete", label: "del", key: "Delete", group: "system", title: "delete to rests (Backspace steps back)" },
    { id: "escape", label: "esc", key: "Escape", group: "system", title: "clear selection / close lane" },
    { id: "enter", label: "⏎", key: "Enter", group: "system", title: "commit (harmony lane) / advance" },
  );
  return specs;
}

/** Which keymap ids the panel reaches — the coverage test's subject. */
export function coveredIds(keymap: Keymap): Set<string> {
  const ids = new Set<string>([...PIANO_COVERS, ...DIGIT_PAD_COVERS, ...Object.keys(MOD_VARIANTS)]);
  for (const s of generatedKeys(keymap)) ids.add(s.id);
  for (const s of physicalKeys()) ids.add(s.id);
  return ids;
}

export interface LatchedMods {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export const NO_MODS: LatchedMods = { shift: false, alt: false, ctrl: false };

/**
 * The KeyboardEvent fields a button press synthesizes, with the sticky
 * modifiers OR-ed in. Real-keyboard semantics: a latched shift
 * transforms e.key the way the LAYOUT's shifted press would — letters
 * uppercase, punctuation follows SHIFTED — and a binding that requires
 * shift OFF simply misses while shift is latched, exactly like the
 * physical key.
 */
export function eventForSpec(spec: VirtualKeySpec, mods: LatchedMods = NO_MODS, layout: Layout = "qwerty"): { key: string; code: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean } {
  let key = spec.key;
  if (mods.shift && spec.shift === undefined && !spec.ctrl && !mods.ctrl) {
    if (/^[a-z]$/.test(key)) key = key.toUpperCase();
    else key = SHIFTED[layout][key] ?? key;
  }
  return {
    key,
    code: spec.code ?? "",
    shiftKey: (spec.shift ?? /^[A-Z]$/.test(spec.key)) || mods.shift,
    altKey: (spec.alt ?? false) || mods.alt,
    ctrlKey: (spec.ctrl ?? false) || mods.ctrl,
  };
}

/**
 * What a button's caption should read under the ACTIVE latches — the
 * panel relabels live so the user sees what shift/alt will do before
 * committing: staccato reads staccatissimo under shift, the digit pad
 * turns into voltas (shift) or fingering (alt), arrows into duration
 * steps. Unchanged captions mean the latch does not re-map that key.
 */
export function displayLabel(spec: VirtualKeySpec, mods: LatchedMods, keymap: Keymap): string {
  if (mods.ctrl) return spec.label; // no ctrl re-mappings on the panel
  if (spec.id === DIGIT_PAD_ID) {
    if (mods.alt) return NEW_FINGER[spec.key] ? `→${NEW_FINGER[spec.key]}` : `f${spec.key}`;
    if (mods.shift) return NEW_FINGER[spec.key] === "5" ? spec.label : `volta ${spec.key}`; // no volta 0
    return spec.label;
  }
  if (!mods.shift && !mods.alt) return spec.label;
  for (const [variantId, v] of Object.entries(MOD_VARIANTS)) {
    if (v.of !== spec.id) continue;
    if ((v.mods.shift ?? false) !== mods.shift || (v.mods.alt ?? false) !== mods.alt) continue;
    if (v.keys && !v.keys.includes(spec.key)) continue;
    return v.labels?.[spec.key] ?? SHORT[variantId] ?? keymap[variantId]?.keys[0] ?? variantId;
  }
  return spec.label;
}
