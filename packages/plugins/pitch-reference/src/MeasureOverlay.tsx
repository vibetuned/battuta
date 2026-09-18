/**
 * The trace over one measure tile, on the host's overlays point. The host
 * hands the tile measured — its box, the noteheads' boxes, each staff's
 * lines with the clef in force — and this component puts the recording's
 * pitch on the staff: the measure's window on the score clock through
 * the alignment picks the frames, the staff whose axis is nearest the
 * trace takes them, the axis is fitted through the measure's own
 * noteheads when it has some, and time runs along the notes' onsets
 * (piecewise linear between them), so the trace lands where the notation
 * put the same moment. Draw-only, translucent, no pointer events — the
 * host's caret and selection are untouched.
 */
import type { CSSProperties } from "react";
import type { Store, TileOverlayProps } from "@battuta/api";
import { toWavMs, type WrittenNote } from "./align";
import { fitAxis, staffAxis, type PitchAxis } from "./axis";
import type { RefState } from "./Panel";
import { useStore } from "./store";
import { tracePath } from "./Panel";
import type { PitchFrame } from "./yin";

const LAYER: CSSProperties = { position: "absolute", inset: 0, overflow: "visible" };

/** A staff's vertical band, with a margin of three spaces above and below, for telling its heads from another staff's. */
const within = (lines: readonly number[], y: number): boolean => {
  const top = lines[0]!;
  const bottom = lines[lines.length - 1]!;
  const space = (bottom - top) / Math.max(1, lines.length - 1);
  return y >= top - 3 * space && y <= bottom + 3 * space;
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * Score time → x in the tile, through the measure's notes: each note's
 * onset sits at its head's centre, the measure's end at the tile's right
 * edge, and time runs linearly between anchors. A measure without heads
 * runs from a third of the width to the edge.
 */
export function timeToX(win: { fromMs: number; toMs: number }, notes: readonly WrittenNote[], boxes: TileOverlayProps["boxes"], width: number): (scoreMs: number) => number {
  const byOnset = new Map<number, number[]>();
  for (const n of notes) {
    const b = boxes[n.id];
    if (!b) continue;
    const xs = byOnset.get(n.fromMs) ?? [];
    xs.push(b.x + b.width / 2);
    byOnset.set(n.fromMs, xs);
  }
  const anchors = [...byOnset.entries()].map(([t, xs]) => ({ t, x: xs.reduce((a, b) => a + b, 0) / xs.length })).sort((a, b) => a.t - b.t);
  const end = { t: win.toMs, x: width - 3 };
  if (anchors.length === 0) anchors.push({ t: win.fromMs, x: width * 0.35 });
  else if (anchors[0]!.t > win.fromMs) {
    const first = anchors[0]!;
    const slope = (end.x - first.x) / Math.max(1, end.t - first.t);
    anchors.unshift({ t: win.fromMs, x: Math.max(0, first.x - (first.t - win.fromMs) * slope) });
  }
  anchors.push(end);
  return (t: number): number => {
    if (t <= anchors[0]!.t) return anchors[0]!.x;
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1]!;
      const b = anchors[i]!;
      if (t <= b.t) return b.t === a.t ? b.x : a.x + ((t - a.t) / (b.t - a.t)) * (b.x - a.x);
    }
    return end.x;
  };
}

/** The staff the trace belongs on: the one whose middle line is nearest the trace's median pitch (or the measure's written notes when nothing is voiced). */
export function pickStaff(staves: TileOverlayProps["staves"], frames: readonly PitchFrame[], notes: readonly WrittenNote[]): { staff: TileOverlayProps["staves"][number]; axis: PitchAxis } | null {
  const axes = staves.map((staff) => ({ staff, axis: staffAxis(staff) })).filter((a): a is { staff: TileOverlayProps["staves"][number]; axis: PitchAxis } => a.axis !== null);
  if (!axes.length) return null;
  const target = median(frames.flatMap((f) => (f.midi === null ? [] : [f.midi]))) ?? median(notes.map((n) => n.midi));
  if (target === null) return axes[0]!;
  return axes.reduce((best, a) => (Math.abs(a.axis.centre - target) < Math.abs(best.axis.centre - target) ? a : best), axes[0]!);
}

export function MeasureOverlay({ tile, state }: { tile: TileOverlayProps; state: Store<RefState> }) {
  const s = useStore(state);
  if (!s.showOverlays || s.status !== "ready" || tile.measureId === null) return null;
  const win = s.measures.find((m) => m.id === tile.measureId);
  if (!win) return null;
  const fromWav = toWavMs(s.alignment, win.fromMs);
  const toWav = toWavMs(s.alignment, win.toMs);
  const frames = s.frames.filter((f) => f.t * 1000 >= fromWav && f.t * 1000 < toWav);
  const notes = s.written.filter((n) => n.measureId === tile.measureId);
  const picked = pickStaff(tile.staves, frames, notes);
  if (!picked) return null;
  const heads = notes.flatMap((n) => {
    const b = tile.boxes[n.id];
    return b && within(picked.staff.lines, b.y + b.height / 2) ? [{ midi: n.midi, y: b.y + b.height / 2 }] : [];
  });
  const axis = fitAxis(picked.axis, heads);
  const xOf = timeToX(win, notes, tile.boxes, tile.width);
  // wav ms → score ms → x
  const xAtWav = (wavMs: number): number => xOf((wavMs - s.alignment.offsetMs) * s.alignment.rate);
  const voiced = frames.filter((f) => f.midi !== null);
  const first = voiced[0];
  return (
    <svg data-pitch-ref-measure data-frames={voiced.length} data-fit={axis.fit} data-staff={picked.staff.n} data-first-y={first && first.midi !== null ? axis.yOf(first.midi).toFixed(1) : ""} width={tile.width} height={tile.height} style={LAYER}>
      {notes.map((n, i) => (
        <rect key={`${n.id}-${i}`} x={xOf(n.fromMs)} width={Math.max(1, xOf(n.toMs) - xOf(n.fromMs))} y={axis.yOf(n.midi) - 1.5} height={3} fill="rgba(60,120,220,0.22)" />
      ))}
      <path d={tracePath(frames, xAtWav, (m) => axis.yOf(m))} fill="none" stroke="#e0a000" strokeWidth={2} strokeLinejoin="round" opacity={0.9} />
    </svg>
  );
}
