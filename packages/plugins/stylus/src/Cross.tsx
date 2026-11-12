/**
 * The cross at the tip, on the host's overlays point, while the pen is down
 * (the user, 2026-11-12). Still, it is a small cross and a ghost notehead
 * where the note will go. Once the pen has moved past `UNFOLD_PX` it unfolds
 * into two rulers that cross like a crossword's words, each cue where the pen
 * has to be to choose it:
 *
 *   - across, above the staff: a cell for every length, an engraved note,
 *     one `STEP_X` apart — the drag's own steps — with the input's length
 *     over the landing point and the choice lit;
 *   - down the landing's column: a letter for every step of the staff, at
 *     that step's height — the lines' letters left of the column, the
 *     spaces' right, so they never touch — with the choice lit, its octave
 *     with it.
 *
 * Every change pulses the lit cell. A chord moves the pitch only: no ruler
 * across. A ruler is wider than a measure, and each tile's frame clips what
 * spills while the next tile covers it, so every tile of the landing's row
 * draws its own part: the plugin reads where each tile starts (`origins`,
 * page x of the tile's frame, by `ctx.stylus.at` when the pen lands), the
 * rulers are laid out once in the row's coordinates — page x, the frames'
 * shared y — and each tile draws them shifted by its own origin.
 * Draw-only, like every overlay: the pen is captured.
 */
import type { CSSProperties } from "react";
import type { Pitch, Store, TileOverlayProps } from "@battuta/api";
import { DURATIONS, STEP_X, type Gesture, type Length } from "./gesture";
import { useStore } from "./store";

/** The small cross's arms. */
const ARM = 10;
/** A length's cell across: the drag's step less a gap, and its height. */
export const CELL_W = STEP_X - 4;
export const CELL_H = 28;
/** A letter's pill is a staff space less a pixel, 9 to 16 px — growing as the editor zooms in — so a side's letters never touch; its centre sits this far from the column, clear of it even lit. */
const pillOffset = (pill: number): number => Math.round(pill * 0.75 + 4);
/** Kept clear inside the frame's top. */
const MARGIN = 2;
const INK = "#1d6fd6";
const LAYER: CSSProperties = { position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" };

/** Page x of each tile frame's left edge in the landing's row, by measure index. */
export type Origins = Readonly<Record<number, number>>;

/** The y of a step on a staff (0 its bottom line), from the staff's lines in the tile. */
export function stepY(lines: readonly number[], step: number): number | null {
  if (lines.length < 2) return null;
  const bottom = lines[lines.length - 1]!;
  return bottom - (step * (bottom - lines[0]!)) / (lines.length - 1) / 2;
}

/** Unicode's notes, drawn by the editor's Noto Music: whole to 64th. */
const NOTE: Record<(typeof DURATIONS)[number], string> = { "1": "\u{1D15D}", "2": "\u{1D15E}", "4": "\u{1D15F}", "8": "\u{1D160}", "16": "\u{1D161}", "32": "\u{1D162}", "64": "\u{1D163}" };
const DOT = "\u{1D16D}";

/** A length as an engraved note, its dots after it. */
export const noteGlyph = (l: Length): string => NOTE[l.dur] + DOT.repeat(l.dots);

/** The written pitch `by` staff steps away: letter by letter, the octave turning at C. */
export function stepPitch(p: Pitch, by: number): Pitch {
  const letters = "cdefgab";
  const n = p.oct * 7 + letters.indexOf(p.pname) + by;
  return { pname: letters[((n % 7) + 7) % 7]!, oct: Math.floor(n / 7) };
}

/** A length's cell across: its centre's page x, its top in the frame, its note, lit when it is the choice. */
export interface LengthCell {
  dur: (typeof DURATIONS)[number];
  x: number;
  y: number;
  note: string;
  lit: boolean;
}

/** A step's letter down the column: its centre (page x, frame y), its letter — with the octave when lit. */
export interface StepPill {
  step: number;
  x: number;
  y: number;
  text: string;
  lit: boolean;
}

export interface Rulers {
  lengths: LengthCell[];
  pills: StepPill[];
  /** The pills' side, from the staff's space. */
  pill: number;
  /** The column: from the ruler across down past the lowest letter. */
  column: { x: number; y1: number; y2: number };
}

/**
 * The two rulers in the row's coordinates. `x` is the landing's page x,
 * `lines` the landing staff's lines in the frame, `landing` the step and
 * pitch the pen landed on, `from` the input's duration's index.
 */
export function rulersOf(x: number, lines: readonly number[], landing: { step: number; pitch: Pitch }, g: { choice: Length & { step: number }; from: number; chord: boolean }): Rulers {
  const top = lines[0] ?? 0;
  const space = lines.length > 1 ? (lines[lines.length - 1]! - top) / (lines.length - 1) : 10;
  const topStep = 2 * (lines.length - 1);
  const pill = Math.max(9, Math.min(16, Math.round(space - 1)));
  const off = pillOffset(pill);
  // The staff and a ledger line either side, and the choice with a step to spare.
  const lo = Math.min(-2, g.choice.step - 1);
  const hi = Math.max(topStep + 2, g.choice.step + 1);
  const pills: StepPill[] = [];
  for (let step = lo; step <= hi; step++) {
    const y = stepY(lines, step);
    if (y === null) continue;
    const p = stepPitch(landing.pitch, step - landing.step);
    const lit = step === g.choice.step;
    // Lines (even steps) left of the column, spaces right: a space apart on each side.
    pills.push({ step, x: x + (step % 2 === 0 ? -off : off), y, text: p.pname.toUpperCase() + (lit ? String(p.oct) : ""), lit });
  }
  const highest = Math.min(...pills.map((p) => p.y)) - pill / 2;
  // Above the staff, clear of the letters above it — unless the frame has no room.
  const rowY = Math.max(MARGIN, Math.min(top - space, highest) - 4 - CELL_H);
  const lengths: LengthCell[] = g.chord
    ? []
    : DURATIONS.map((dur, i) => ({ dur, x: x + (i - g.from) * STEP_X, y: rowY, note: noteGlyph({ dur, dots: g.choice.dots }), lit: dur === g.choice.dur }));
  const lowest = Math.max(...pills.map((p) => p.y)) + pill / 2;
  return { lengths, pills, pill, column: { x, y1: g.chord ? highest - 4 : rowY + CELL_H, y2: lowest + 2 } };
}

/** The unfolding and the cue, as keyframes the cells name; none for a reader who asked for less motion. */
const MOTION = `@keyframes battuta-stylus-unfold { from { transform: translateX(var(--from-x)) scale(0.3); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes battuta-stylus-cue { from { transform: scale(1.25); } to { transform: none; } }
@media (prefers-reduced-motion: reduce) { [data-stylus-cell], [data-stylus-pill] { animation: none !important; } }`;

const MUSIC = '"Noto Music", system-ui, sans-serif';
const BOX: CSSProperties = { position: "absolute", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", lineHeight: 1, overflow: "hidden" };

function LengthView({ c, ox, k }: { c: LengthCell; ox: number; k: number }) {
  const style: CSSProperties = {
    ...BOX,
    left: c.x - ox - CELL_W / 2,
    top: c.y,
    width: CELL_W,
    height: CELL_H,
    borderRadius: 5,
    background: c.lit ? INK : "rgba(20, 28, 38, .86)",
    border: c.lit ? "2px solid #fff" : "1px solid rgba(255, 255, 255, .25)",
    // Unfolding from the crossing, each cell a little after the one before it; the lit one pulses on every change.
    animation: c.lit ? "battuta-stylus-cue 160ms ease-out" : `battuta-stylus-unfold 160ms ease-out ${Math.abs(k) * 25}ms both`,
    ...({ "--from-x": `${-k * STEP_X}px` } as CSSProperties),
  };
  return (
    <div data-stylus-cell={c.dur} data-lit={c.lit || undefined} style={style}>
      <span style={{ fontFamily: MUSIC, fontSize: 19, lineHeight: 1 }}>{c.note}</span>
    </div>
  );
}

function PillView({ p, ox, size }: { p: StepPill; ox: number; size: number }) {
  const w = p.lit ? size + 11 : size;
  const style: CSSProperties = {
    ...BOX,
    left: p.x - ox - w / 2,
    top: p.y - size / 2,
    width: w,
    height: size,
    borderRadius: 4,
    font: `700 ${Math.round(size * (p.lit ? 0.77 : 0.7))}px/1 system-ui, sans-serif`,
    background: p.lit ? INK : "rgba(20, 28, 38, .72)",
    animation: p.lit ? "battuta-stylus-cue 160ms ease-out" : "battuta-stylus-unfold 160ms ease-out both",
  };
  return (
    <div data-stylus-pill={p.step} data-lit={p.lit || undefined} style={style}>
      {p.text}
    </div>
  );
}

export function Cross({ tile, state, origins }: { tile: TileOverlayProps; state: Store<Gesture>; origins: Store<Origins> }) {
  const g = useStore(state);
  const o = useStore(origins);
  if (g.kind !== "cross") return null;
  const own = tile.measureIndex === g.landing.at.measureIndex;
  // Where this tile's frame starts on the page: the landing's own tile from the landing, the row's others as read when the pen landed.
  const ox = own ? g.landing.x - g.landing.at.tile.x : o[tile.measureIndex];
  if (ox === undefined) return null;
  const staff = tile.staves.find((s) => s.n === g.landing.at.staffN);
  const x = g.landing.x - ox;
  const { y } = g.landing.at.tile;
  const headY = staff ? stepY(staff.lines, g.choice.step) : null;
  const head = headY !== null && <ellipse data-stylus-head cx={x} cy={headY} rx={6} ry={4.5} transform={`rotate(-20 ${x} ${headY})`} fill={INK} opacity={0.6} />;
  if (!g.unfolded) {
    if (!own) return null;
    return (
      <div data-stylus-cross="small" style={LAYER}>
        <svg width={tile.width} height={tile.height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          {head}
          <g stroke={INK} strokeWidth={2} strokeLinecap="round" fill="none" opacity={0.85}>
            <line x1={x} y1={y - ARM} x2={x} y2={y + ARM} />
            {/* A chord's pitch joins the note's own length: no arm across. */}
            {!g.chord && <line x1={x - ARM} y1={y} x2={x + ARM} y2={y} />}
          </g>
        </svg>
      </div>
    );
  }
  if (!staff) return null;
  const r = rulersOf(g.landing.x, staff.lines, g.landing.at, g);
  const cue = `${g.choice.dur}.${g.choice.dots}.${g.choice.step}`;
  return (
    <div data-stylus-cross="unfolded" style={LAYER}>
      <style>{MOTION}</style>
      <svg width={tile.width} height={tile.height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <line x1={r.column.x - ox} y1={r.column.y1} x2={r.column.x - ox} y2={r.column.y2} stroke={INK} strokeWidth={2} strokeLinecap="round" opacity={0.7} />
        {head}
      </svg>
      {r.lengths.map((c, i) => (
        // The lit cell remounts on every change of the choice, so its cue plays again.
        <LengthView key={c.lit ? `lit:${cue}` : c.dur} c={c} ox={ox} k={i - g.from} />
      ))}
      {r.pills.map((p) => (
        <PillView key={p.lit ? `lit:${cue}` : `step:${p.step}`} p={p} ox={ox} size={r.pill} />
      ))}
    </div>
  );
}
