/**
 * battuta's PLAYBACK as a standard MIDI file — the player's exact
 * interpretation, not Verovio's written-score MIDI: the expanded form
 * (repeats, voltas, one D.S./D.C. jump), tie chains merged into single
 * held notes, and the articulation/slur gates (staccato half value,
 * legato/tenuto full, everything else slightly detached). Feed it the
 * same PlaybackData the player consumes.
 *
 * Timemap tstamps are real milliseconds, so the file uses 500 ticks per
 * quarter at 120 bpm — exactly 1 tick = 1 ms — and event times carry
 * over without rounding drift (the score's own tempo is already baked
 * into the timemap).
 */
import { mergeTiedSpans, GATE_DEFAULT } from "@battuta/core";
import type { PlaybackData } from "./render/renderPool";

const VELOCITY = 102; // the player's 0.8

/** MIDI variable-length quantity. */
const vlq = (n: number): number[] => {
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
};

export function playbackToMidi(data: PlaybackData): Uint8Array {
  // Note lengths from the timemap's own on→off spans (same as play()).
  const onAt = new Map<string, number>();
  const durMs = new Map<string, number>();
  for (const ev of data.events) {
    for (const id of ev.on ?? []) if (!onAt.has(id)) onAt.set(id, ev.tstamp);
    for (const id of ev.off ?? []) {
      const t0 = onAt.get(id);
      if (t0 !== undefined && !durMs.has(id)) durMs.set(id, Math.max(60, ev.tstamp - t0));
    }
  }
  const vis = (id: string): string => data.idMap[id] ?? id;
  const ties = data.shaping?.ties ?? {};
  const gates = data.shaping?.gates ?? {};
  const { roots, durations } = mergeTiedSpans(data.events, ties, data.idMap);

  const notes: { tick: number; off: boolean; pitch: number }[] = [];
  for (const ev of data.events) {
    for (const id of ev.on ?? []) {
      if (roots[id] !== id) continue; // tie continuation: already sounding
      const note = data.notes[id];
      if (!note) continue;
      const gate = gates[vis(id)] ?? GATE_DEFAULT;
      const ms = durations[id] ?? durMs.get(id) ?? 300;
      notes.push({ tick: Math.round(ev.tstamp), off: false, pitch: note.pitch });
      notes.push({ tick: Math.round(ev.tstamp + ms * gate), off: true, pitch: note.pitch });
    }
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
