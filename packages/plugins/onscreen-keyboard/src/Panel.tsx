/**
 * The panel itself: a two-octave piano (one on a phone), the modifier latches, and one
 * button per action — the keymap's rows generated from `ctx.keymap`, the
 * locked rows hand-listed in keys.ts.
 *
 * It holds real state of its own (the latches, the held notes, the octave
 * rail), so it must never be disposed-and-reopened to show new data: that
 * remounts it and resets the user's octave mid-phrase. The host's stores
 * are subscribed one level up (index.tsx) and arrive here as props.
 *
 * No `position: fixed`: in 0.0.3 this bar positioned itself along the
 * bottom, which was right when App.tsx mounted it and wrong the moment the
 * host's own panel area — itself fixed, with a z-index and a max-height —
 * became its parent.
 */
import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { KeymapEntry } from "@battuta/api";
import { actionFor, BACKSPACE, displayLabel, groupKeys, NO_MODS, type LatchedMods } from "./keys";

const WHITE_SEMIS = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const BLACKS: [number, number][] = [
  // [semitone, index of the white key it follows]
  [1, 0],
  [3, 1],
  [6, 3],
  [8, 4],
  [10, 5],
];
/** The rail's top: the lower octave shown at C7 — on a phone, the only one — reaches the piano's last keys. */
const OCT_MAX = 7;

/**
 * The row's height, declared rather than inherited. Until slice 4b it was
 * an accident: the tallest child was the modifier column, three 34px
 * buttons and two gaps. Dropping the ctrl latch (§7.8) took it to two, and
 * the row shrank to whatever the shortcut groups happen to be — which is
 * both visibly shorter AND too tight for the horizontal scrollbar the
 * groups need, so the scrollbar squeezed the buttons and the host's panel
 * area sprouted a vertical one. 110 is what the three-button column gave,
 * and it leaves the ~15px a classic (non-overlay) scrollbar takes.
 */
const ROW_HEIGHT = 110;

const KEY_BTN: CSSProperties = {
  minWidth: 44,
  minHeight: 34,
  padding: "2px 8px",
  fontSize: 12,
  borderRadius: 4,
  border: "1px solid #3a4a5e",
  background: "#26303d",
  color: "#cdd6e0",
  cursor: "pointer",
  touchAction: "manipulation",
};

const LATCHED: CSSProperties = { background: "#4a7dbd", color: "#fff", borderColor: "#4a7dbd" };

/**
 * One panel, two arrangements, by CSS alone (a plugin never reads the
 * window): in landscape a single line — octaves, piano, latches, the
 * scrolling action groups, × and ⌫; in portrait two — the playing line
 * (octaves, piano, latches, × and ⌫) over the groups, which take a line of
 * their own — because one line squeezes the piano to a sliver at a
 * tablet's portrait width (2026-10-20, M2). Same elements either way, so
 * turning the tablet keeps the octave rail and the latches as they were.
 *
 * A phone shows one octave, not two (2026-10-21, the user: two left the
 * keys too thin to play): the upper octave's block is hidden and the lower
 * one takes the piano's width, so every key is twice as wide. A phone is a
 * touch screen whose shorter side is under 600 px — the host's own phone
 * width — so it holds upright and sideways, and a tablet never matches.
 */
const LAYOUT_CSS = `
[data-vkeys] { display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: stretch; padding: 8px 10px; background: #1a222d; user-select: none; }
[data-vkeys] > [data-vk-piano] { flex: 0 0 clamp(240px, 34vw, 460px); }
[data-vkeys] > [data-vk-groups] { flex: 1 1 0; min-width: 0; order: 4; }
[data-vkeys] > [data-vk-pinned] { order: 5; }
[data-vkeys] [data-vk-octave] { position: relative; flex: 1; display: flex; }
@media (orientation: portrait) {
  [data-vkeys] > [data-vk-piano] { flex: 1 1 auto; }
  [data-vkeys] > [data-vk-pinned] { order: 4; }
  [data-vkeys] > [data-vk-groups] { order: 5; flex: 1 0 100%; }
}
@media (pointer: coarse) and (max-width: 599px), (pointer: coarse) and (max-height: 599px) {
  [data-vkeys] [data-vk-octave="1"] { display: none; }
}
`;

export interface KeyboardPanelProps {
  /** The UNION keymap as data: core ∪ every enabled plugin's contributions. */
  keymap: readonly KeymapEntry[];
  /** Note entry on? The piano dims outside it, exactly as in 0.0.3. */
  entryMode: boolean;
  /** Does the host's action table know this id? See index.tsx for the "not yet installed" case. */
  runnable: (action: string) => boolean;
  /** Run an action by id — `ctx.actions.run`. */
  onAction: (action: string) => void;
  onNoteOn: (midiNote: number) => void;
  onNoteOff: (midiNote: number) => void;
  onClose: () => void;
}

export function KeyboardPanel({ keymap, entryMode, runnable, onAction, onNoteOn, onNoteOff, onClose }: KeyboardPanelProps) {
  /** Lowest shown octave: oct 3 shows C3–B4 (middle C on the left half), C3–B3 on a phone. */
  const [oct, setOct] = useState(3);
  const [mods, setMods] = useState<LatchedMods>(NO_MODS);
  const [held, setHeld] = useState<Set<number>>(new Set());

  const stepOctave = (d: number) => setOct((o) => Math.min(OCT_MAX, Math.max(0, o + d)));

  const noteOn = (midi: number) => {
    setHeld((h) => new Set(h).add(midi));
    onNoteOn(midi);
  };
  const noteOff = (midi: number) => {
    setHeld((h) => {
      if (!h.has(midi)) return h;
      const next = new Set(h);
      next.delete(midi);
      return next;
    });
    onNoteOff(midi);
  };

  // Rebuilt on every render: `keymap` and `runnable` both change with the
  // host's stores, and the list is tens of entries — a useMemo keyed on
  // both would cost more to keep correct than it saves.
  const groups = groupKeys(keymap, runnable);

  // Piano geometry in percent of ONE octave's width: each octave is a block
  // of its own, so a phone can hide the upper one (LAYOUT_CSS).
  const whiteW = 100 / 7;
  const blackW = whiteW * 0.62;

  const keyEvents = (midi: number) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault(); // no focus steal, no synthetic mouse events
      noteOn(midi);
    },
    onPointerUp: () => noteOff(midi),
    onPointerCancel: () => noteOff(midi),
    onPointerLeave: () => noteOff(midi),
  });

  const modBtn = (name: keyof LatchedMods) => (
    <button
      key={name}
      data-vk-mod={name}
      title={`latch ${name} for the next key`}
      onClick={() => setMods((m) => ({ ...m, [name]: !m[name] }))}
      style={{ ...KEY_BTN, minWidth: 40, ...(mods[name] ? LATCHED : {}) }}
    >
      {name}
    </button>
  );

  const rail = (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: 34 }}>
      <button data-vk-oct-up style={{ ...KEY_BTN, minWidth: 30, flex: 1 }} title="octaves up" onClick={() => stepOctave(1)}>
        ▲
      </button>
      <span data-vk-oct style={{ color: "#8b99a9", fontSize: 11, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
        C{oct}
      </span>
      <button data-vk-oct-down style={{ ...KEY_BTN, minWidth: 30, flex: 1 }} title="octaves down" onClick={() => stepOctave(-1)}>
        ▼
      </button>
    </div>
  );

  const piano = (
    <div
      data-vk-piano
      // Its width is LAYOUT_CSS's: a third of the screen beside the groups
      // in landscape, the line's width in portrait.
      style={{ position: "relative", minHeight: ROW_HEIGHT, touchAction: "none", opacity: entryMode ? 1 : 0.55 }}
      title={entryMode ? "tap to enter notes — hold several for a chord; wheel/swipe the rail for octaves" : "press input (i) first — the piano enters notes in input mode"}
      onWheel={(e) => stepOctave(e.deltaY > 0 ? -1 : 1)}
    >
      <div style={{ display: "flex", height: "100%" }}>
        {[0, 1].map((o) => (
          // laid out by LAYOUT_CSS, not inline: an inline display would win over the phone's rule
          <div key={o} data-vk-octave={o}>
            {WHITE_SEMIS.map((semi, i) => {
              const midi = (oct + 1 + o) * 12 + semi;
              return (
                <div
                  key={midi}
                  data-vk-note={midi}
                  {...keyEvents(midi)}
                  style={{ flex: 1, background: held.has(midi) ? "#9fc3ea" : "#f3f5f7", border: "1px solid #556", borderRadius: "0 0 4px 4px", display: "flex", alignItems: "flex-end", justifyContent: "center", color: "#667", fontSize: 10, paddingBottom: 2 }}
                >
                  {i === 0 ? `C${oct + o}` : ""}
                </div>
              );
            })}
            {BLACKS.map(([semi, after]) => {
              const midi = (oct + 1 + o) * 12 + semi;
              return (
                <div
                  key={midi}
                  data-vk-note={midi}
                  {...keyEvents(midi)}
                  style={{ position: "absolute", top: 0, left: `${(after + 1) * whiteW - blackW / 2}%`, width: `${blackW}%`, height: "60%", background: held.has(midi) ? "#4a7dbd" : "#222a34", border: "1px solid #111", borderRadius: "0 0 3px 3px", zIndex: 1 }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );

  const latches = <div style={{ display: "flex", flexDirection: "column", gap: 4, justifyContent: "center" }}>{(["alt", "shift"] as const).map(modBtn)}</div>;

  // The groups scroll sideways and never vertically: a horizontal
  // scrollbar eats into this box's height, and with overflowY left to
  // "auto" the shortfall becomes a second, vertical scrollbar inside the
  // panel. ROW_HEIGHT is what keeps the buttons clear of it.
  const actions = (
    <div data-vk-groups style={{ display: "flex", gap: 12, overflowX: "auto", overflowY: "hidden", alignItems: "stretch" }}>
      {groups.map((g) => (
        <div key={g.name} data-vk-group={g.name} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ color: "#6b7a8b", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>{g.name}</span>
          <div style={{ display: "grid", gridTemplateRows: "repeat(2, auto)", gridAutoFlow: "column", gap: 4 }}>
            {g.specs.map((s, i) => {
              // Live relabel: the caption shows what the button does
              // UNDER the active latches, and a re-mapped button is
              // tinted to match. A latch that reaches nothing leaves the
              // caption alone, so the panel never advertises a dead key.
              const label = displayLabel(s, mods, keymap, runnable);
              const action = actionFor(s, mods, keymap, runnable);
              return (
                <button
                  key={`${s.id}:${s.key ?? s.label}:${i}`}
                  data-vk-key={s.id}
                  data-vk-action={action ?? ""}
                  title={s.title}
                  onClick={() => {
                    if (action !== null) onAction(action);
                    // One-shot latch — cleared even by a button the latch
                    // reaches nothing on. NOT `disabled`: a disabled
                    // button fires no click, so the latch would stick.
                    if (mods.shift || mods.alt) setMods(NO_MODS);
                  }}
                  style={{ ...KEY_BTN, ...(label !== s.label ? { color: "#9fc3ea", borderColor: "#4a7dbd" } : {}), ...(action === null ? { opacity: 0.4 } : {}) }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  // × and ⌫, pinned: always in reach, never scrolled away with the groups.
  const backspaceRuns = runnable(BACKSPACE.action);
  const pinned = (
    <div data-vk-pinned style={{ display: "flex", flexDirection: "column", gap: 4, alignSelf: "flex-start" }}>
      <button data-vk-close title="hide the on-screen keyboard" onClick={onClose} style={{ ...KEY_BTN, minWidth: 30 }}>
        ×
      </button>
      <button
        data-vk-key={BACKSPACE.id}
        data-vk-action={backspaceRuns ? BACKSPACE.action : ""}
        title={BACKSPACE.title}
        onClick={() => {
          if (backspaceRuns) onAction(BACKSPACE.action);
          if (mods.shift || mods.alt) setMods(NO_MODS);
        }}
        style={{ ...KEY_BTN, minWidth: 30, fontSize: 15, ...(backspaceRuns ? {} : { opacity: 0.4 }) }}
      >
        {BACKSPACE.label}
      </button>
    </div>
  );

  return (
    <div data-vkeys>
      <style>{LAYOUT_CSS}</style>
      {rail}
      {piano}
      {latches}
      {actions}
      {pinned}
    </div>
  );
}
