/**
 * The panel itself: a two-octave piano, the modifier latches, and one
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
import { actionFor, displayLabel, groupKeys, NO_MODS, type LatchedMods } from "./keys";

const WHITE_SEMIS = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const BLACKS: [number, number][] = [
  // [semitone, index of the white key it follows]
  [1, 0],
  [3, 1],
  [6, 3],
  [8, 4],
  [10, 5],
];
const WHITE_COUNT = 14; // two octaves

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
  /** Lowest shown octave: oct 3 shows C3–B4 (middle C on the left half). */
  const [oct, setOct] = useState(3);
  const [mods, setMods] = useState<LatchedMods>(NO_MODS);
  const [held, setHeld] = useState<Set<number>>(new Set());

  const stepOctave = (d: number) => setOct((o) => Math.min(6, Math.max(0, o + d)));

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

  // Piano geometry in percent of the piano width.
  const whiteW = 100 / WHITE_COUNT;
  const blackW = whiteW * 0.62;
  const whites = Array.from({ length: WHITE_COUNT }, (_, i) => ({
    midi: (oct + 1 + Math.floor(i / 7)) * 12 + WHITE_SEMIS[i % 7]!,
    label: i % 7 === 0 ? `C${oct + Math.floor(i / 7)}` : "",
  }));
  const blacks = [0, 1].flatMap((o) =>
    BLACKS.map(([semi, after]) => ({
      midi: (oct + 1 + o) * 12 + semi,
      left: (o * 7 + after + 1) * whiteW - blackW / 2,
    })),
  );

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

  return (
    <div data-vkeys style={{ display: "flex", gap: 10, alignItems: "stretch", padding: "8px 10px", background: "#1a222d", userSelect: "none" }}>
      {/* --- piano: octave rail + two octaves of keys ------------------- */}
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
      <div
        data-vk-piano
        style={{ position: "relative", flex: "0 0 clamp(240px, 34vw, 460px)", minHeight: ROW_HEIGHT, touchAction: "none", opacity: entryMode ? 1 : 0.55 }}
        title={entryMode ? "tap to enter notes — hold several for a chord; wheel/swipe the rail for octaves" : "press input (i) first — the piano enters notes in input mode"}
        onWheel={(e) => stepOctave(e.deltaY > 0 ? -1 : 1)}
      >
        <div style={{ display: "flex", height: "100%" }}>
          {whites.map((w) => (
            <div
              key={w.midi}
              data-vk-note={w.midi}
              {...keyEvents(w.midi)}
              style={{ flex: 1, background: held.has(w.midi) ? "#9fc3ea" : "#f3f5f7", border: "1px solid #556", borderRadius: "0 0 4px 4px", display: "flex", alignItems: "flex-end", justifyContent: "center", color: "#667", fontSize: 10, paddingBottom: 2 }}
            >
              {w.label}
            </div>
          ))}
        </div>
        {blacks.map((b) => (
          <div
            key={b.midi}
            data-vk-note={b.midi}
            {...keyEvents(b.midi)}
            style={{ position: "absolute", top: 0, left: `${b.left}%`, width: `${blackW}%`, height: "60%", background: held.has(b.midi) ? "#4a7dbd" : "#222a34", border: "1px solid #111", borderRadius: "0 0 3px 3px", zIndex: 1 }}
          />
        ))}
      </div>
      {/* --- modifier latches ------------------------------------------- */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, justifyContent: "center" }}>{(["alt", "shift"] as const).map(modBtn)}</div>
      {/* --- action groups, horizontally scrollable ---------------------- */}
      {/* The groups scroll sideways and never vertically: a horizontal
          scrollbar eats into this box's height, and with overflowY left to
          "auto" the shortfall becomes a second, vertical scrollbar inside
          the panel. ROW_HEIGHT is what keeps the buttons clear of it. */}
      <div style={{ display: "flex", gap: 12, overflowX: "auto", overflowY: "hidden", flex: 1, alignItems: "stretch" }}>
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
      <button data-vk-close title="hide the on-screen keyboard" onClick={onClose} style={{ ...KEY_BTN, minWidth: 30, alignSelf: "flex-start" }}>
        ×
      </button>
    </div>
  );
}
