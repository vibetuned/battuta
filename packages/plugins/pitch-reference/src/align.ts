/**
 * Putting the recording and the score on one clock. The score's clock is
 * the timemap's (milliseconds at the score's own tempo — taken, never
 * estimated from the audio); the recording's is the file's. Two numbers
 * join them: an OFFSET, where bar 1 starts in the file, and a RATE, the
 * take's tempo over the score's. wav = offset + score / rate.
 *
 * Also here: what the timemap says was written — every sounding note
 * with its span, and every measure's window — and how far the trace sits
 * from it. Dynamic time warping, which would align measure by measure
 * through a rubato, is the next version; nothing here precludes it.
 */
import type { Timemap } from "@battuta/api";
import type { PitchFrame } from "./yin";

export interface Alignment {
  /** Where bar 1 begins in the recording, ms. */
  offsetMs: number;
  /** The take's tempo ÷ the score's: 1 is "as written", 0.5 is half speed. */
  rate: number;
}

export const toWavMs = (a: Alignment, scoreMs: number): number => a.offsetMs + scoreMs / a.rate;
export const toScoreMs = (a: Alignment, wavMs: number): number => (wavMs - a.offsetMs) * a.rate;

/** The take's tempo over the score's; 1 when the user has not said. */
export const rateOf = (recordedTempo: number | null, scoreTempo: number): number => (recordedTempo !== null && recordedTempo > 0 && scoreTempo > 0 ? recordedTempo / scoreTempo : 1);

/**
 * Where the take begins: the start of the first run of `minRun` voiced
 * frames (a single voiced frame is a click, not a note), in ms, less half
 * a window so the note's onset and not the frame's centre is named. 0
 * when nothing is voiced.
 */
export function detectOffsetMs(frames: readonly PitchFrame[], minRun = 3, halfWindowMs = 32): number {
  let run = 0;
  for (let i = 0; i < frames.length; i++) {
    run = frames[i]!.midi === null ? 0 : run + 1;
    if (run === minRun) return Math.max(0, frames[i - minRun + 1]!.t * 1000 - halfWindowMs);
  }
  return 0;
}

export interface WrittenNote {
  /** The engraved id (a repeat pass's clone mapped back). */
  id: string;
  fromMs: number;
  toMs: number;
  /** Sounding pitch, MIDI. */
  midi: number;
  /** The engraved id of the measure the note starts in. */
  measureId: string | null;
}

/** Every sounding note of the timemap, in onset order: on at its event, off at its own off event (or its written duration). */
export function writtenNotes(tm: Timemap): WrittenNote[] {
  const engraved = (id: string): string => tm.idMap[id] ?? id;
  const offAt = new Map<string, number>();
  for (const e of tm.events) for (const id of e.off ?? []) if (!offAt.has(id)) offAt.set(id, e.tstamp);
  const out: WrittenNote[] = [];
  let measure: string | null = null;
  for (const e of tm.events) {
    if (e.measureOn) measure = engraved(e.measureOn);
    for (const id of e.on ?? []) {
      const note = tm.notes[id];
      if (!note) continue;
      const to = offAt.get(id) ?? e.tstamp + note.duration;
      out.push({ id: engraved(id), fromMs: e.tstamp, toMs: Math.max(to, e.tstamp + 1), midi: note.pitch, measureId: measure });
    }
  }
  return out;
}

export interface MeasureWindow {
  /** The engraved id — what the overlays point names a tile by. */
  id: string;
  fromMs: number;
  toMs: number;
}

/** Each measure's window on the score clock; a repeated measure keeps its FIRST pass (the tile is one measure, the take may play it twice). */
export function measureWindows(tm: Timemap): MeasureWindow[] {
  const engraved = (id: string): string => tm.idMap[id] ?? id;
  const starts = tm.events.filter((e) => e.measureOn).map((e) => ({ id: engraved(e.measureOn!), tstamp: e.tstamp }));
  const end = tm.events.reduce((m, e) => Math.max(m, e.tstamp), 0);
  const seen = new Set<string>();
  const out: MeasureWindow[] = [];
  starts.forEach((s, i) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    out.push({ id: s.id, fromMs: s.tstamp, toMs: Math.max(starts[i + 1]?.tstamp ?? end, s.tstamp + 1) });
  });
  return out;
}

export interface Deviation {
  /** Median distance, in semitones, between a voiced frame and the nearest written pitch sounding at its score time. */
  median: number;
  /** How many frames had a written note to compare with. */
  compared: number;
}

/** How far the trace sits from what was written, through the alignment; null when no voiced frame lands on a written note. */
export function deviation(frames: readonly PitchFrame[], notes: readonly WrittenNote[], a: Alignment): Deviation | null {
  const devs: number[] = [];
  for (const f of frames) {
    if (f.midi === null) continue;
    const s = toScoreMs(a, f.t * 1000);
    let best = Infinity;
    for (const n of notes) {
      if (n.fromMs <= s && s < n.toMs) {
        const d = Math.abs(f.midi - n.midi);
        if (d < best) best = d;
      }
    }
    if (best !== Infinity) devs.push(best);
  }
  if (devs.length === 0) return null;
  devs.sort((x, y) => x - y);
  const mid = devs.length >> 1;
  return { median: devs.length % 2 ? devs[mid]! : (devs[mid - 1]! + devs[mid]!) / 2, compared: devs.length };
}
