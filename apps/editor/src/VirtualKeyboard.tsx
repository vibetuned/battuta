/**
 * On-screen keyboard for tablets and touch devices: a two-octave piano
 * that drives the SAME entry path as Web MIDI (explicit pitch + octave,
 * multi-touch chords, caret advance on release), sticky ctrl/alt/shift
 * latches, and one button per keymap action — generated from the LIVE
 * keymap so rebinds and new actions appear on their own. Shortcut
 * buttons synthesize window KeyboardEvents; the app's single keydown
 * handler does the rest, untouched.
 */
import { useMemo, useState } from "react";
import type { Keymap, Layout } from "./keymap";
import { generatedKeys, physicalKeys, eventForSpec, displayLabel, NO_MODS, type LatchedMods, type VirtualKeySpec } from "./virtualKeys";

/** Panel group order; groups the keymap grows later append after these. */
const GROUP_ORDER = ["nav", "digits", "entry", "accidentals", "marks", "rhythm", "repeats", "system"];

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

const KEY_BTN: React.CSSProperties = {
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

export function VirtualKeyboard({
  keymap,
  layout,
  entryMode,
  onNoteOn,
  onNoteOff,
  onClose,
}: {
  keymap: Keymap;
  layout: Layout;
  entryMode: boolean;
  onNoteOn: (midiNote: number) => void;
  onNoteOff: (midiNote: number) => void;
  onClose: () => void;
}) {
  /** Lowest shown octave: oct 3 shows C3–B4 (middle C on the left half). */
  const [oct, setOct] = useState(3);
  const [mods, setMods] = useState<LatchedMods>(NO_MODS);
  const [held, setHeld] = useState<Set<number>>(new Set());

  const stepOctave = (d: number) => setOct((o) => Math.min(6, Math.max(0, o + d)));

  const press = (spec: VirtualKeySpec) => {
    const ev = eventForSpec(spec, mods, layout);
    window.dispatchEvent(new KeyboardEvent("keydown", { ...ev, bubbles: true, cancelable: true }));
    if (mods.shift || mods.alt || mods.ctrl) setMods(NO_MODS); // one-shot latch
  };

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

  const groups = useMemo(() => {
    const specs = [...generatedKeys(keymap), ...physicalKeys()];
    const names = [...GROUP_ORDER, ...specs.map((s) => s.group).filter((g) => !GROUP_ORDER.includes(g))];
    return [...new Set(names)].map((name) => ({ name, specs: specs.filter((s) => s.group === name) })).filter((g) => g.specs.length > 0);
  }, [keymap]);

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
    onPointerDown: (e: React.PointerEvent) => {
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
      style={{ ...KEY_BTN, minWidth: 40, ...(mods[name] ? { background: "#4a7dbd", color: "#fff", borderColor: "#4a7dbd" } : {}) }}
    >
      {name}
    </button>
  );

  return (
    <div
      data-vkeys
      style={{ position: "fixed", left: 0, right: 0, bottom: 24, zIndex: 25, display: "flex", gap: 10, alignItems: "stretch", padding: "8px 10px", background: "#1a222d", borderTop: "1px solid #2c3a4a", userSelect: "none" }}
    >
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
        style={{ position: "relative", flex: "0 0 clamp(240px, 34vw, 460px)", touchAction: "none", opacity: entryMode ? 1 : 0.55 }}
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
      <div style={{ display: "flex", flexDirection: "column", gap: 4, justifyContent: "center" }}>
        {(["ctrl", "alt", "shift"] as const).map(modBtn)}
      </div>
      {/* --- shortcut groups, horizontally scrollable -------------------- */}
      <div style={{ display: "flex", gap: 12, overflowX: "auto", flex: 1, alignItems: "stretch" }}>
        {groups.map((g) => (
          <div key={g.name} data-vk-group={g.name} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ color: "#6b7a8b", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>{g.name}</span>
            <div style={{ display: "grid", gridTemplateRows: "repeat(2, auto)", gridAutoFlow: "column", gap: 4 }}>
              {g.specs.map((s, i) => {
                // Live relabel: the caption shows what the key does UNDER
                // the active latches; a remapped key is tinted to match.
                const label = displayLabel(s, mods, keymap);
                return (
                  <button key={`${s.id}:${s.label}:${i}`} data-vk-key={s.id} title={s.title} onClick={() => press(s)} style={{ ...KEY_BTN, ...(label !== s.label ? { color: "#9fc3ea", borderColor: "#4a7dbd" } : {}) }}>
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
