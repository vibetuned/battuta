/**
 * Plays the WRITTEN notes through the host's MIDI outputs — plain note-on
 * and note-off, one velocity, channel 1 — from the playhead on, at the
 * recording's pace (score time through the alignment), so "▶ score" and
 * "▶ song" from the same playhead sound together. Every note is handed to
 * the sink at once: the sink keeps them in delivery order behind one
 * timer, and its panic releases and cancels everything on pause. No
 * performance decisions (ties, articulations) — the playback plugin has
 * those; this is the reference pitch, plainly.
 */
import type { MidiOutputs } from "@battuta/api";
import { toWavMs, type Alignment, type WrittenNote } from "./align";

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const VELOCITY = 100;
/** A same-pitch note that follows at once must re-attack: the off lands this much before the next on. */
const GAP_MS = 10;
/** After the last off, before the player calls itself ended. */
const TAIL_MS = 50;

export class ScorePlayer {
  private sink: MidiOutputs | null = null;
  private startedAt = 0;
  private fromMs = 0;
  private active = false;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  /** Called when the last note has been released (not on pause). */
  onEnded: (() => void) | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  get playing(): boolean {
    return this.active;
  }

  /**
   * Schedule every written note from `fromWavMs` on; a note already
   * sounding there starts now. `semitones` moves every pitch — the panel
   * passes the INVERSE of its trace transposition, so the score sounds in
   * the register the take was sung in (a voice an octave under the
   * written part: the trace is shifted +12 to meet the notes, the notes
   * are played −12 to meet the voice).
   */
  play(sink: MidiOutputs, notes: readonly WrittenNote[], alignment: Alignment, fromWavMs: number, semitones = 0): void {
    this.stop();
    this.sink = sink;
    const t0 = this.now();
    let last = 0;
    for (const n of notes) {
      const off = toWavMs(alignment, n.toMs) - fromWavMs - GAP_MS;
      if (off <= 0) continue; // over before the playhead
      const on = Math.max(0, toWavMs(alignment, n.fromMs) - fromWavMs);
      if (off <= on) continue;
      const pitch = Math.round(n.midi + semitones);
      if (pitch < 0 || pitch > 127) continue;
      sink.schedule([NOTE_ON, pitch, VELOCITY], t0 + on);
      sink.schedule([NOTE_OFF, pitch, 0], t0 + off);
      if (off > last) last = off;
    }
    this.startedAt = t0;
    this.fromMs = fromWavMs;
    this.active = true;
    this.endTimer = setTimeout(() => {
      this.endTimer = null;
      if (!this.active) return;
      this.active = false;
      this.fromMs = fromWavMs + last;
      this.onEnded?.();
    }, last + TAIL_MS);
  }

  /** Where playback is now, ms of the recording's clock — the start position when not playing. */
  position(): number {
    return this.active ? this.fromMs + (this.now() - this.startedAt) : this.fromMs;
  }

  /** Release and cancel everything; keep the position; return it. */
  pause(): number {
    const pos = this.position();
    this.stop();
    this.fromMs = pos;
    return pos;
  }

  private stop(): void {
    if (this.endTimer !== null) clearTimeout(this.endTimer);
    this.endTimer = null;
    if (this.active) this.sink?.panic();
    this.active = false;
  }
}
