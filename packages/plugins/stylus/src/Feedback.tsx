/**
 * Handwriting on the host's overlays point, over the tile the symbol is
 * written on: the ink — the strokes as they are drawn, since the pen is
 * captured and the page draws nothing — until the symbol is read; then
 * what was read, with a small ✓ ✗ to confirm (✓ if left alone, ✗ undoes
 * and offers the other answers), or, when the model was unsure, a chooser
 * of its top answers with a last row to discard the symbol. Everything is
 * placed inside the symbol's measure,
 * since the next tile's layer covers anything that spills right. Fingers
 * tap the buttons as buttons; the pen is captured, so the plugin matches a
 * pen tap to a button's page rectangle itself (`optionRect`, `confirmRect`).
 * The mode item in the status bar lives here too.
 */
import type { CSSProperties } from "react";
import type { Store, TileOverlayProps } from "@battuta/api";
import { Glyph } from "./glyphs";
import type { Origins, Point } from "./handwriting";
import { useStore } from "./store";

export type Mode = "cross" | "handwriting" | "slur";

export interface Option {
  label: string;
  name: string;
  confidence: number;
}

/** The strokes under the pen, in page px, with the page origin of every tile the pen crossed: each draws them in its own frame, so a stroke shows all over the row. */
export interface Ink {
  origins: Origins;
  strokes: readonly (readonly Point[])[];
}

export type Feedback =
  | { kind: "none" }
  /** What was written, at a corner in the tile's px — the class as engraved, its confidence when a classifier gave one; with ✓ ✗ when `confirm`. */
  | { kind: "label"; measureIndex: number; x: number; y: number; label: string; name: string; confidence: number | null; confirm: boolean }
  /** The chooser's top left corner, in the tile's px, and its options; a last row discards. */
  | { kind: "chooser"; measureIndex: number; x: number; y: number; options: readonly Option[] };

/** The chooser's last row, past the options: nothing is written. */
export const DISCARD = "none of these";

/** The chooser's buttons: one below the other, this big, from its corner — the options, then the discard row. */
export const OPTION_W = 160;
export const OPTION_H = 30;
export const OPTION_GAP = 4;
/** The ✓ and ✗ buttons, side by side from the label's corner. */
export const CONFIRM_W = 30;
export const CONFIRM_H = 26;

/** Where option `i` sits, from the chooser's corner in any frame: page px or the tile's. */
export const optionRect = (x: number, y: number, i: number): { x: number; y: number; w: number; h: number } => ({ x, y: y + i * (OPTION_H + OPTION_GAP), w: OPTION_W, h: OPTION_H });

/** The chooser's height for its options and the discard row. */
export const chooserHeight = (options: number): number => (options + 1) * (OPTION_H + OPTION_GAP);

/** Where ✓ (0) and ✗ (1) sit, from the label's corner. */
export const confirmRect = (x: number, y: number, i: number): { x: number; y: number; w: number; h: number } => ({ x: x + i * (CONFIRM_W + 4), y, w: CONFIRM_W, h: CONFIRM_H });

const INK = "#1d6fd6";
const LAYER: CSSProperties = { position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" };
const LABEL: CSSProperties = { position: "absolute", background: "rgba(20, 28, 38, .9)", color: "#fff", font: "12px/1.3 system-ui, sans-serif", display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", borderRadius: 4, whiteSpace: "nowrap", transform: "translateY(-100%)" };
const BUTTON: CSSProperties = { position: "absolute", boxSizing: "border-box", background: "rgba(20, 28, 38, .92)", color: "#fff", font: "13px system-ui, sans-serif", border: "1px solid rgba(255,255,255,.25)", borderRadius: 6, pointerEvents: "auto", cursor: "pointer" };
const OPTION: CSSProperties = { ...BUTTON, width: OPTION_W, height: OPTION_H, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px", textAlign: "left" };
const CONFIRM: CSSProperties = { ...BUTTON, width: CONFIRM_W, height: CONFIRM_H, padding: 0, fontSize: 15, lineHeight: `${CONFIRM_H - 2}px` };
const QUIET: CSSProperties = { color: "#aebccc", fontSize: 12 };

/** The strokes being written, over every tile the pen has crossed. */
export function InkLayer({ tile, state }: { tile: TileOverlayProps; state: Store<Ink | null> }) {
  const ink = useStore(state);
  const origin = ink?.origins[tile.measureIndex];
  if (!ink || !origin) return null;
  return (
    <div data-stylus-ink style={LAYER}>
      <svg width={tile.width} height={tile.height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <g stroke={INK} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.9}>
          {ink.strokes.map((s, i) => {
            const pts = s.map((p) => `${p[0] - origin[0]},${p[1] - origin[1]}`);
            return s.length === 1 ? <circle key={i} cx={s[0]![0] - origin[0]} cy={s[0]![1] - origin[1]} r={1.5} fill={INK} stroke="none" /> : <polyline key={i} points={pts.join(" ")} />;
          })}
        </g>
      </svg>
    </div>
  );
}

/** What was read, or the chooser. */
export function FeedbackLayer({ tile, state, onPick, onConfirm }: { tile: TileOverlayProps; state: Store<Feedback>; onPick: (i: number) => void; onConfirm: (yes: boolean) => void }) {
  const f = useStore(state);
  if (f.kind === "none" || f.measureIndex !== tile.measureIndex) return null;
  if (f.kind === "label") {
    const yes = confirmRect(f.x, f.y, 0);
    const no = confirmRect(f.x, f.y, 1);
    return (
      <div data-stylus-feedback style={LAYER}>
        <div data-stylus-read title={f.name} style={{ ...LABEL, left: f.x, top: f.y - 4 }}>
          <Glyph label={f.label} />
          {f.confidence !== null && <span style={QUIET}>{Math.round(f.confidence * 100)} %</span>}
        </div>
        {f.confirm && (
          <>
            <button type="button" data-stylus-confirm="yes" style={{ ...CONFIRM, left: yes.x, top: yes.y }} onClick={() => onConfirm(true)} title="Keep it">
              ✓
            </button>
            <button type="button" data-stylus-confirm="no" style={{ ...CONFIRM, left: no.x, top: no.y }} onClick={() => onConfirm(false)} title="Not that: undo and choose">
              ✗
            </button>
          </>
        )}
      </div>
    );
  }
  return (
    <div data-stylus-feedback style={LAYER}>
      {f.options.map((o, i) => {
        const r = optionRect(f.x, f.y, i);
        return (
          <button key={o.label} type="button" data-stylus-option={o.label} title={o.name} style={{ ...OPTION, left: r.x, top: r.y }} onClick={() => onPick(i)}>
            <Glyph label={o.label} />
            <span style={QUIET}>{Math.round(o.confidence * 100)} %</span>
          </button>
        );
      })}
      <button type="button" data-stylus-option="discard" style={{ ...OPTION, ...QUIET, left: optionRect(f.x, f.y, f.options.length).x, top: optionRect(f.x, f.y, f.options.length).y }} onClick={() => onPick(f.options.length)}>
        <span>{DISCARD}</span>
      </button>
    </div>
  );
}

/** The three modes as the item shows them, in the order a tap cycles them. */
export const MODES: Record<Mode, { text: string; title: string }> = {
  cross: { text: "✎ cross", title: "The pen writes notes with the cross; tap for handwriting" },
  handwriting: { text: "✎ hand", title: "The pen writes symbols by hand; tap for slurs and ties" },
  slur: { text: "✎ slur", title: "The pen draws slurs and ties from note to note; tap for the cross" },
};

/** The header item, beside the other plugins' buttons (the status bar until 1.3.11): the mode, tapped to switch (the user's choice over a pen gesture). */
export function ModeItem({ mode, onToggle }: { mode: Store<Mode>; onToggle: () => void }) {
  const m = useStore(mode);
  return (
    <button type="button" data-stylus-mode={m} title={MODES[m].title} onClick={onToggle}>
      {MODES[m].text}
    </button>
  );
}
