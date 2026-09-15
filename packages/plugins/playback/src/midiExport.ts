/**
 * battuta's PLAYBACK as a standard MIDI file — the player's exact
 * interpretation, not Verovio's written-score MIDI: the expanded form
 * (repeats, voltas, one D.S./D.C. jump), tie chains merged into single
 * held notes, and the articulation/slur gates (staccato half value,
 * legato/tenuto full, everything else slightly detached). Feed it the
 * same Performance the player plays.
 *
 * Timemap tstamps are real milliseconds, so the file uses 500 ticks per
 * quarter at 120 bpm — exactly 1 tick = 1 ms — and event times carry
 * over without rounding drift (the score's own tempo is already baked
 * into the timemap).
 */
import type { Performance } from "./performance";

const VELOCITY = 102; // the player's 0.8

/** MIDI variable-length quantity. */
const vlq = (n: number): number[] => {
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
};

/** Clamp a transposed pitch into MIDI range. */
const transposed = (pitch: number, semitones: number): number => Math.min(127, Math.max(0, pitch + semitones));

export function playbackToMidi(perf: Performance, opts: { transpose?: number } = {}): Uint8Array {
  const transpose = opts.transpose ?? 0;
  const notes: { tick: number; off: boolean; pitch: number }[] = [];
  for (const n of perf.notes) {
    const pitch = transposed(n.pitch, transpose);
    notes.push({ tick: Math.round(n.onMs), off: false, pitch });
    notes.push({ tick: Math.round(n.onMs + n.durMs), off: true, pitch });
  }
  // Offs sort before ons at the same tick: a repeated pitch re-attacks
  // instead of its off silencing the fresh note.
  notes.sort((a, b) => a.tick - b.tick || Number(b.off) - Number(a.off));

  const track: number[] = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20]; // tempo 500000 µs/quarter
  let last = 0;
  for (const n of notes) {
    track.push(...vlq(n.tick - last), n.off ? 0x80 : 0x90, n.pitch & 0x7f, n.off ? 0 : VELOCITY);
    last = n.tick;
  }
  track.push(0, 0xff, 0x2f, 0); // end of track

  const be32 = (n: number) => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const be16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
  // MThd: format 0, one track, 500 ticks per quarter (1 tick = 1 ms).
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, ...be32(6), ...be16(0), ...be16(1), ...be16(500), 0x4d, 0x54, 0x72, 0x6b, ...be32(track.length), ...track]);
}
