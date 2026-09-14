/**
 * The panel's key model: which buttons it shows, and — since slice 4a —
 * the ACTION ID each one runs. Nothing here builds an event.
 *
 * The 0.0.3 panel synthesized a `KeyboardEvent` per button and let the
 * App's one keydown handler sort it out, which meant the panel could
 * reach every branch of that handler (`ctrl+s` included) with an opaque
 * `{key, ctrlKey}` blob. The host now names its actions
 * (`apps/editor/src/host/actions.ts`) and `ctx.actions.run(id)` enters the
 * same table a key enters, under the same state conditions — so a button
 * is a *named* action, and the panel can do nothing the host has not
 * published. Three consequences shape this file:
 *
 *  - A rebindable keymap row's id IS its action id, so generated buttons
 *    need no table at all: they come straight from `ctx.keymap`.
 *  - The locked rows (`system`, `navigation`, `structural`, the digit pad)
 *    each cover SEVERAL actions, so their buttons name the action
 *    explicitly (`file.save`, `nav.left`, `measure.insert`, `duration.4`).
 *  - A latched modifier selects a VARIANT action (staccato →
 *    staccatissimo, ← → duration.shorter) instead of re-casing a
 *    character. A latch with no declared variant therefore does nothing —
 *    which is what a shifted press did in 0.0.3 too, because the shifted
 *    character simply missed the binding.
 *
 * Kept apart from the component so `test/keys.test.ts` can hold it
 * against the UNION keymap (core ∪ every enabled plugin's contributions):
 * an action the panel cannot reach fails CI, whoever contributed it.
 */
import type { KeymapEntry } from "@battuta/api";

/** Sticky latches. There is no ctrl latch any more — see README, "What it does not do". */
export interface LatchedMods {
  shift: boolean;
  alt: boolean;
}

export const NO_MODS: LatchedMods = { shift: false, alt: false };

/** What a latched modifier turns a button into. */
export interface KeyVariant {
  shift?: boolean;
  alt?: boolean;
  /** The action id run while these latches are on. */
  action: string;
  /** Caption while latched. Falls back to SHORT[action], then the base's caption. */
  label?: string;
  /**
   * The keymap ROW this variant advertises, when it has one of its own
   * (`staccatissimo`, `tuplet`, a plugin's command). Unset for actions
   * that live inside a locked row (`select.left` is in `navigation`).
   * When set, the row must be in the live keymap or the caption is not
   * shown — a binding whose plugin is off must not be advertised.
   */
  row?: string;
}

export interface PanelKey {
  /**
   * The button's id — what `data-vk-key` carries. A keymap row id, so
   * several buttons can share one (`navigation`, `system`), or
   * DIGIT_PAD_ID, or one of EXTRA_IDS.
   */
  id: string;
  label: string;
  group: string;
  title: string;
  /** What a plain tap runs. */
  action: string;
  /** Which member of a shared row this is (a digit, an arrow's key name). */
  key?: string;
  variants?: KeyVariant[];
}

/** Panel group order; groups the keymap grows later append after these. */
export const GROUP_ORDER: readonly string[] = ["nav", "digits", "entry", "accidentals", "marks", "rhythm", "repeats", "system"];

/** Keymap rows the piano itself covers — no button needed. */
export const PIANO_COVERS: readonly string[] = ["pitches"];

export const DIGIT_PAD_ID = "digitPad";

/** Keymap rows the one digit pad serves, picked by the latch. */
export const DIGIT_PAD_COVERS: readonly string[] = ["durations", "voltas", "fingering", "fingerChange"];

/** Buttons for actions the App handles outside the keymap. */
export const EXTRA_IDS: readonly string[] = ["delete", "escape"];

/** alt+6–0 substitutes to this new finger (the App's own mapping). */
const FINGER_CHANGE: Record<string, string> = { "6": "1", "7": "2", "8": "3", "9": "4", "0": "5" };

/**
 * Keymap rows reached by LATCHING a modifier on another button instead of
 * having one of their own — mirroring the physical pairs the keymap
 * documents (marcato IS the accent key shifted). `keys` restricts which of
 * the base's buttons carry the variant; `action` names the action id when
 * it is not the row id itself (a locked row covers several).
 */
export interface ModVariant {
  /** The base button's id. */
  of: string;
  mods: { shift?: boolean; alt?: boolean };
  /** Only these base keys carry the variant (default: all). */
  keys?: string[];
  /** The action id, or one per base key. Default: the row id, which for a rebindable row IS the action id. */
  action?: string | Record<string, string>;
  /** Label per base key while the latch is on. */
  labels?: Record<string, string>;
}

export const MOD_VARIANTS: Record<string, ModVariant> = {
  slurDoubleSharp: { of: "sharp", mods: { shift: true } },
  intensity: { of: "inputMode", mods: { shift: true } },
  tuplet: { of: "tie", mods: { shift: true } },
  // Contributed by @battuta/plugin-reflection: the row id is that plugin's
  // COMMAND id, and since api 0.1.3 `ctx.actions.run` reaches it — a
  // plugin's action is runnable by id exactly when its key would have
  // worked. Turn that plugin off and both its keymap row and its command
  // leave, so `reachable()` below drops the caption with the behaviour.
  "battuta.reflection.cycle": { of: "rest", mods: { shift: true } },
  pedal: { of: "dynamics", mods: { shift: true } },
  staccatissimo: { of: "staccato", mods: { shift: true } },
  marcato: { of: "accent", mods: { shift: true } },
  measureRepeat: { of: "simile", mods: { shift: true } },
  // A locked row covering two actions: alt+← shortens, alt+→ lengthens.
  durationStep: {
    of: "navigation",
    mods: { alt: true },
    keys: ["ArrowLeft", "ArrowRight"],
    action: { ArrowLeft: "duration.shorter", ArrowRight: "duration.longer" },
    labels: { ArrowLeft: "dur −", ArrowRight: "dur +" },
  },
};

/** Short captions for generated buttons; the fallback is the bound key. */
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
  staffGroup: "grp {",
  lyrics: "lyrics",
  contextBar: "ctx bar",
  tuplet: "tuplet",
  "battuta.reflection.cycle": "reflect",
  beam: "beam",
  "file.saveAs": "save as",
};

/** Every variant a base button carries, resolved for one of its keys. */
function variantsOf(baseId: string, key?: string): KeyVariant[] {
  const out: KeyVariant[] = [];
  for (const [row, v] of Object.entries(MOD_VARIANTS)) {
    if (v.of !== baseId) continue;
    if (v.keys && (key === undefined || !v.keys.includes(key))) continue;
    const action = typeof v.action === "string" ? v.action : v.action ? v.action[key ?? ""] : row;
    if (action === undefined) continue;
    const label = key === undefined ? undefined : v.labels?.[key];
    out.push({
      ...(v.mods.shift !== undefined ? { shift: v.mods.shift } : {}),
      ...(v.mods.alt !== undefined ? { alt: v.mods.alt } : {}),
      action,
      ...(label !== undefined ? { label } : {}),
      row,
    });
  }
  return out;
}

const withVariants = (spec: PanelKey): PanelKey => {
  const extra = variantsOf(spec.id, spec.key);
  if (!extra.length) return spec;
  return { ...spec, variants: [...(spec.variants ?? []), ...extra] };
};

/**
 * One button per rebindable keymap row, in the keymap's own order. A
 * rebind or a brand-new action — core's or a plugin's — appears here
 * without touching this file, which is the whole point of the panel being
 * a projection: the row's id is the action id the button runs.
 */
export function generatedKeys(entries: readonly KeymapEntry[]): PanelKey[] {
  return entries
    .filter((e) => !e.locked && e.keys[0] !== undefined && !MOD_VARIANTS[e.id])
    .map((e) => withVariants({ id: e.id, label: SHORT[e.id] ?? e.keys[0]!, group: e.group, title: e.label, action: e.id }));
}

/**
 * Buttons for the LOCKED rows — the digit pad, the arrows and paging, the
 * numpad structure, the ctrl chords — and for the two actions that live
 * outside the keymap (Delete, Escape). Hand-written because each locked
 * row covers several actions, and the coverage test keeps the list honest
 * as the keymap grows.
 */
export function physicalKeys(): PanelKey[] {
  const specs: PanelKey[] = [];
  // Digit pad — the grid flows column-first over two rows, so this order
  // renders as 1 2 3 4 5 over 6 7 8 9 0. Labels carry the duration glyph
  // (7 = whole … 1 = 64th) since that is what a plain tap does. The action
  // is computed per latch (digitAction), not declared: one button serves
  // durations, voltas, fingering and finger change.
  const DUR_GLYPH: Record<string, string> = { "7": "𝅝", "6": "𝅗𝅥", "5": "♩", "4": "♪", "3": "𝅘𝅥𝅯", "2": "𝅘𝅥𝅰", "1": "𝅘𝅥𝅱" };
  for (const digit of ["1", "6", "2", "7", "3", "8", "4", "9", "5", "0"]) {
    const glyph = DUR_GLYPH[digit];
    const alt = FINGER_CHANGE[digit] ? `finger change →${FINGER_CHANGE[digit]}` : `fingering ${digit} (add: shift too)`;
    specs.push({
      id: DIGIT_PAD_ID,
      label: glyph ? `${digit} ${glyph}` : digit,
      key: digit,
      action: digitAction(digit, NO_MODS) ?? "",
      group: "digits",
      title: `${glyph ? `duration ${glyph} (input mode)` : "digit"} · shift: volta ${digit} · alt: ${alt}`,
    });
  }
  specs.push(
    // Nav is a 2-row/column-flow grid: this order renders as a D-pad —
    // (home, ←) (↑, ↓) (end, →) then the paging column.
    { id: "rowNavigation", label: "⇤", key: "Home", action: "nav.home", group: "nav", title: "row start" },
    {
      id: "navigation",
      label: "←",
      key: "ArrowLeft",
      action: "nav.left",
      group: "nav",
      title: "previous event (latch shift to select, alt to shorten)",
      variants: [{ shift: true, action: "select.left" }],
    },
    {
      id: "navigation",
      label: "↑",
      key: "ArrowUp",
      action: "nav.up",
      group: "nav",
      title: "voice up / line up (latch alt to transpose, alt+shift for an octave)",
      variants: [
        { alt: true, action: "transpose.up" },
        { alt: true, shift: true, action: "transpose.octaveUp" },
      ],
    },
    {
      id: "navigation",
      label: "↓",
      key: "ArrowDown",
      action: "nav.down",
      group: "nav",
      title: "voice down / line down (latch alt to transpose, alt+shift for an octave)",
      variants: [
        { alt: true, action: "transpose.down" },
        { alt: true, shift: true, action: "transpose.octaveDown" },
      ],
    },
    { id: "rowNavigation", label: "⇥", key: "End", action: "nav.end", group: "nav", title: "row end" },
    {
      id: "navigation",
      label: "→",
      key: "ArrowRight",
      action: "nav.right",
      group: "nav",
      title: "next event (latch shift to select, alt to lengthen)",
      variants: [{ shift: true, action: "select.right" }],
    },
    { id: "rowNavigation", label: "pg↑", key: "PageUp", action: "nav.pageUp", group: "nav", title: "previous row" },
    { id: "rowNavigation", label: "pg↓", key: "PageDown", action: "nav.pageDown", group: "nav", title: "next row" },
    { id: "structural", label: "+m", key: "insert", action: "measure.insert", group: "system", title: "insert measure" },
    { id: "structural", label: "−m", key: "delete", action: "measure.delete", group: "system", title: "delete measure" },
    { id: "structural", label: "⧉m", key: "duplicate", action: "measure.duplicate", group: "system", title: "duplicate measure" },
    { id: "system", label: "save", key: "save", action: "file.save", group: "system", title: "save (latch shift for save as)", variants: [{ shift: true, action: "file.saveAs" }] },
    { id: "system", label: "open", key: "open", action: "file.open", group: "system", title: "open a score" },
    { id: "system", label: "undo", key: "undo", action: "undo", group: "system", title: "undo" },
    { id: "system", label: "redo", key: "redo", action: "redo", group: "system", title: "redo" },
    { id: "system", label: "copy", key: "copy", action: "clipboard.copy", group: "system", title: "copy block/measure" },
    { id: "system", label: "paste", key: "paste", action: "clipboard.paste", group: "system", title: "paste (replace measures)" },
    { id: "system", label: "z+", key: "zoomIn", action: "zoom.in", group: "system", title: "zoom in" },
    { id: "system", label: "z−", key: "zoomOut", action: "zoom.out", group: "system", title: "zoom out" },
    { id: "system", label: "z0", key: "zoomReset", action: "zoom.reset", group: "system", title: "reset zoom" },
    { id: "delete", label: "del", key: "delete", action: "edit.delete", group: "system", title: "delete to rests" },
    { id: "escape", label: "esc", key: "escape", action: "edit.escape", group: "system", title: "clear selection" },
  );
  return specs.map(withVariants);
}

/** Every button, in render order: the keymap's own rows first, then the locked ones. */
export const panelKeys = (entries: readonly KeymapEntry[]): PanelKey[] => [...generatedKeys(entries), ...physicalKeys()];

/** The keymap rows the panel reaches — the coverage test's subject. */
export function coveredIds(entries: readonly KeymapEntry[]): Set<string> {
  const ids = new Set<string>([...PIANO_COVERS, ...DIGIT_PAD_COVERS, ...Object.keys(MOD_VARIANTS)]);
  for (const s of panelKeys(entries)) ids.add(s.id);
  return ids;
}

/** Every action id any button can run, under any latch. What `ctx.actions.ids` must contain. */
export function actionIds(entries: readonly KeymapEntry[]): Set<string> {
  const out = new Set<string>();
  for (const s of panelKeys(entries)) {
    if (s.id === DIGIT_PAD_ID) {
      for (const mods of [NO_MODS, { shift: true, alt: false }, { shift: false, alt: true }, { shift: true, alt: true }]) {
        const a = digitAction(s.key ?? "", mods);
        if (a) out.add(a);
      }
      continue;
    }
    out.add(s.action);
    for (const v of s.variants ?? []) out.add(v.action);
  }
  return out;
}

/**
 * The action one digit-pad button runs under the active latches: plain
 * 1–7 = duration, shift 1–9 = volta, alt 1–5 = fingering (shift adds),
 * alt 6–0 = finger change. Null where the App binds nothing (a plain 8,
 * a shifted 0) — exactly the presses that did nothing in 0.0.3.
 */
export function digitAction(digit: string, mods: LatchedMods): string | null {
  if (mods.alt) {
    if (/^[1-5]$/.test(digit)) return mods.shift ? `finger.add.${digit}` : `finger.${digit}`;
    const f = FINGER_CHANGE[digit];
    // The App's fingerChange rule ignores shift, so alt+shift+6 is a
    // finger change too. Reproduced rather than tidied.
    return f ? `fingerChange.${f}` : null;
  }
  if (mods.shift) return /^[1-9]$/.test(digit) ? `volta.${digit}` : null; // there is no volta 0
  return /^[1-7]$/.test(digit) ? `duration.${digit}` : null; // 8, 9 and 0 set no duration
}

/** The variant selected by the active latches, if this button has one. */
export function variantFor(spec: PanelKey, mods: LatchedMods): KeyVariant | null {
  for (const v of spec.variants ?? []) {
    if ((v.shift ?? false) === mods.shift && (v.alt ?? false) === mods.alt) return v;
  }
  return null;
}

/**
 * Can the panel honestly offer this variant? Two questions, because they
 * are two different failures: a row the live keymap does not carry (its
 * plugin is off, or the binding was withdrawn), and an action the host's
 * table does not know. Either way, say nothing rather than advertise a
 * caption for a key that does nothing.
 */
function reachable(v: KeyVariant, entries: readonly KeymapEntry[], runnable: (action: string) => boolean): boolean {
  if (v.row !== undefined && !entries.some((e) => e.id === v.row)) return false;
  return runnable(v.action);
}

/**
 * The action a tap runs, or null when the tap does nothing. The SAME
 * reachability rule as `displayLabel`, so a caption and a tap can never
 * disagree: a button that says "reflect" runs the reflection cycle, and a
 * button that cannot run its action does not say it can.
 */
export function actionFor(spec: PanelKey, mods: LatchedMods, entries: readonly KeymapEntry[], runnable: (action: string) => boolean = () => true): string | null {
  if (spec.id === DIGIT_PAD_ID) {
    const a = digitAction(spec.key ?? "", mods);
    return a !== null && runnable(a) ? a : null;
  }
  if (!mods.shift && !mods.alt) return runnable(spec.action) ? spec.action : null;
  const v = variantFor(spec, mods);
  // A latch with no declared variant does nothing — as in 0.0.3, where the
  // shifted character simply missed the binding.
  if (!v || !reachable(v, entries, runnable)) return null;
  return v.action;
}

/**
 * What a button's caption reads under the ACTIVE latches — the panel
 * relabels live so the user sees what shift/alt will do before committing:
 * staccato reads staccatissimo under shift, the digit pad turns into
 * voltas (shift) or fingering (alt), arrows into duration steps. An
 * unchanged caption means the latch does not re-map that key.
 */
export function displayLabel(spec: PanelKey, mods: LatchedMods, entries: readonly KeymapEntry[], runnable: (action: string) => boolean = () => true): string {
  if (spec.id === DIGIT_PAD_ID) {
    const digit = spec.key ?? "";
    if (mods.alt) return FINGER_CHANGE[digit] ? `→${FINGER_CHANGE[digit]}` : `f${digit}`;
    if (mods.shift) return FINGER_CHANGE[digit] === "5" ? spec.label : `volta ${digit}`; // no volta 0
    return spec.label;
  }
  if (!mods.shift && !mods.alt) return spec.label;
  const v = variantFor(spec, mods);
  if (!v || !reachable(v, entries, runnable)) return spec.label;
  return v.label ?? SHORT[v.action] ?? spec.label;
}

/** The buttons grouped for rendering, in GROUP_ORDER then the keymap's own order. */
export function groupKeys(entries: readonly KeymapEntry[], runnable: (action: string) => boolean = () => true): { name: string; specs: PanelKey[] }[] {
  // A button whose plain action the host does not know is not rendered: a
  // projection shows what the editor can actually do. (Before the App has
  // installed its table `runnable` says yes to everything — see index.tsx.)
  const specs = panelKeys(entries).filter((s) => (s.id === DIGIT_PAD_ID ? true : runnable(s.action)));
  const names = [...GROUP_ORDER, ...specs.map((s) => s.group).filter((g) => !GROUP_ORDER.includes(g))];
  return [...new Set(names)].map((name) => ({ name, specs: specs.filter((s) => s.group === name) })).filter((g) => g.specs.length > 0);
}
