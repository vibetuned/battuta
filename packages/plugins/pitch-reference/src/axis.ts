/**
 * Pitch to a place on a staff. The clef puts one pitch on one line (G2 →
 * G4 on the second line, F4 → F3 on the fourth, C → C4 on its line;
 * octave clefs shift it) and the staff spacing gives a step; between
 * them a semitone is 7/12 of a half-space, so an octave spans 3½ spaces
 * as it does on paper. That is the CLEF axis, right for a measure of
 * rests. When the tile has engraved noteheads, the HEADS axis is fitted
 * through them instead, so the trace sits exactly where the notation put
 * the same pitch.
 */
import type { ClefContext, OverlayStaff } from "@battuta/api";

export interface PitchAxis {
  yOf(midi: number): number;
  midiOf(y: number): number;
  /** The pitch at the middle line, for choosing a staff. */
  centre: number;
  /** Pixels per semitone (positive; y grows downward). */
  perSemitone: number;
  fit: "clef" | "heads";
}

/** The sounding pitch the clef puts on its line, and the line (1 = bottom). Null for a clef without pitch (percussion, tablature). */
export function clefPitch(clef: ClefContext): { midi: number; line: number } | null {
  const base = clef.shape === "G" ? 67 : clef.shape === "F" ? 53 : clef.shape === "C" ? 60 : null;
  if (base === null) return null;
  const octaves = clef.dis === 8 ? 1 : clef.dis === 15 ? 2 : 0;
  const shift = octaves * 12 * (clef.disPlace === "below" ? -1 : 1);
  return { midi: base + shift, line: clef.line };
}

const axis = (yRef: number, midiRef: number, perSemitone: number, centre: number, fit: PitchAxis["fit"]): PitchAxis => ({
  yOf: (m) => yRef - (m - midiRef) * perSemitone,
  midiOf: (y) => midiRef - (y - yRef) / perSemitone,
  centre,
  perSemitone,
  fit,
});

/** The clef axis of a measured staff; null when the staff has no pitched clef or too few lines. */
export function staffAxis(staff: OverlayStaff): PitchAxis | null {
  const lines = staff.lines;
  if (lines.length < 2) return null;
  const ref = clefPitch(staff.context.clef);
  if (!ref) return null;
  const top = lines[0]!;
  const bottom = lines[lines.length - 1]!;
  const space = (bottom - top) / (lines.length - 1);
  const perSemitone = (space / 2) * (7 / 12);
  const yRef = lines[lines.length - ref.line];
  if (yRef === undefined || perSemitone <= 0) return null;
  const clefAxis = axis(yRef, ref.midi, perSemitone, 0, "clef");
  return { ...clefAxis, centre: clefAxis.midiOf((top + bottom) / 2) };
}

/**
 * The same axis pulled onto engraved heads: one head shifts the axis so it
 * sits exactly there; two or more of different pitch give a least-squares
 * line, kept only when its slope agrees with the staff's within a factor
 * of two (a fit that does not is heads from another staff).
 */
export function fitAxis(base: PitchAxis, heads: readonly { midi: number; y: number }[]): PitchAxis {
  if (heads.length === 0) return base;
  const distinct = new Set(heads.map((h) => h.midi));
  if (distinct.size === 1) {
    const h = heads[0]!;
    const shift = h.y - base.yOf(h.midi);
    return { ...axis(base.yOf(h.midi) + shift, h.midi, base.perSemitone, base.centre, "heads") };
  }
  const n = heads.length;
  let sm = 0;
  let sy = 0;
  let smm = 0;
  let smy = 0;
  for (const h of heads) {
    sm += h.midi;
    sy += h.y;
    smm += h.midi * h.midi;
    smy += h.midi * h.y;
  }
  const denom = n * smm - sm * sm;
  if (denom === 0) return base;
  const b = (n * smy - sm * sy) / denom;
  const a = (sy - b * sm) / n;
  const perSemitone = -b;
  if (!(perSemitone > base.perSemitone / 2 && perSemitone < base.perSemitone * 2)) return base;
  return { yOf: (m) => a + b * m, midiOf: (y) => (y - a) / b, centre: base.centre, perSemitone, fit: "heads" };
}
