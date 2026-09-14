/**
 * The MIDI OUTPUT handle behind `MidiService.openOutputs()`: when the page
 * view's MIDI box is checked, the player sends note on/off to every
 * connected MIDI output (each one is some synth's input) instead of the
 * built-in piano.
 *
 * The backends (Web MIDI outputs in browsers, the shell's midir bridge)
 * live in host/midi.ts; this class is what both hand back. Events are
 * scheduled with plain timers (a few ms of jitter, fine for MIDI), every
 * sounding note is tracked, and panic() cancels what is pending and
 * RELEASES what is sounding — pause, seek, tempo changes and stop must
 * never leave a note hanging on an external synth.
 */
import type { MidiOutputs } from "@battuta/api";

export const NOTE_ON = 0x90;
export const NOTE_OFF = 0x80;
const ALL_NOTES_OFF = [0xb0, 123, 0];

export class MidiSink implements MidiOutputs {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private sounding = new Set<number>();

  constructor(
    /** Deduped names of the ports being sent to (HUD/notice text). */
    readonly names: readonly string[],
    private readonly transmit: (data: number[]) => void,
    /** Backend teardown, run once by close() after the panic. */
    private readonly release: () => void = () => undefined,
  ) {}

  /** Send now (tracked like a scheduled send). */
  send(data: number[]): void {
    this.track(data);
    this.transmit(data);
  }

  /** Send at `atMs` (performance.now() clock); past times send now. */
  schedule(data: number[], atMs: number): void {
    const delay = Math.max(0, atMs - performance.now());
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.track(data);
      this.transmit(data);
    }, delay);
    this.timers.add(t);
  }

  private track(data: number[]): void {
    const [status, pitch, velocity] = data;
    if (status === undefined || pitch === undefined) return;
    if ((status & 0xf0) === NOTE_ON && (velocity ?? 0) > 0) this.sounding.add(pitch);
    else if ((status & 0xf0) === NOTE_OFF || ((status & 0xf0) === NOTE_ON && velocity === 0)) this.sounding.delete(pitch);
  }

  /** Cancel everything pending and release everything sounding. */
  panic(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const pitch of this.sounding) this.transmit([NOTE_OFF, pitch, 0]);
    this.sounding.clear();
    this.transmit(ALL_NOTES_OFF); // belt and braces for anything missed
  }

  /** panic(), then hand the ports back to the backend. */
  close(): void {
    this.panic();
    this.release();
  }
}
