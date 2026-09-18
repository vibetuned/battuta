/**
 * The MIDI OUTPUT handle behind `MidiService.openOutputs()`: when the page
 * view's MIDI box is checked, the player sends note on/off to every
 * connected MIDI output (each one is some synth's input) instead of the
 * built-in piano.
 *
 * The backends (Web MIDI outputs in browsers, the shell's midir bridge)
 * live in host/midi.ts; this class is what both hand back. Events wait in
 * ONE queue in delivery order behind one timer (a few ms of jitter, fine
 * for MIDI; the order never varies), every sounding note is tracked, and
 * panic() cancels what is pending and
 * RELEASES what is sounding — pause, seek, tempo changes and stop must
 * never leave a note hanging on an external synth.
 */
import type { MidiOutputs } from "@battuta/api";

export const NOTE_ON = 0x90;
export const NOTE_OFF = 0x80;
const ALL_NOTES_OFF = [0xb0, 123, 0];

/** A scheduled message: when, what, and its place in line. */
interface Pending {
  at: number;
  data: number[];
  seq: number;
}

/** Note-off (or a note-on at velocity 0, running-status off). */
const isOff = (d: number[]): boolean => ((d[0] ?? 0) & 0xf0) === NOTE_OFF || (((d[0] ?? 0) & 0xf0) === NOTE_ON && (d[2] ?? 0) === 0);
const isOn = (d: number[]): boolean => ((d[0] ?? 0) & 0xf0) === NOTE_ON && (d[2] ?? 0) > 0;

/**
 * Delivery order: by time; at one instant every note-off before every
 * note-on (the sequencer's rule — a synth handed on/on/off keeps a voice
 * until "all notes off"); then the order of scheduling.
 */
const before = (a: Pending, b: Pending): number => {
  if (a.at !== b.at) return a.at - b.at;
  const ka = isOff(a.data) ? 0 : isOn(a.data) ? 2 : 1;
  const kb = isOff(b.data) ? 0 : isOn(b.data) ? 2 : 1;
  return ka - kb || a.seq - b.seq;
};

/** Messages due within this many ms of the one the timer fired for go out in the same flush, in order. */
const FLUSH_WINDOW_MS = 1;

export class MidiSink implements MidiOutputs {
  /** Everything scheduled and not yet sent, kept in delivery order; ONE timer, armed for the head. */
  private queue: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
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

  /**
   * Send at `atMs` (performance.now() clock); past times send now. One
   * timer per message was the first design (slice 3): two messages a few
   * ms apart could then fire in either order under a coarse or throttled
   * timer, and a same-pitch note-on delivered before the previous note's
   * off leaves a voice sounding on the synth until the panic. The queue
   * makes the order a property of the data, not of the timers
   * (2026-09-18, a note held to the end of a piece on an external synth).
   */
  schedule(data: number[], atMs: number): void {
    const entry: Pending = { at: atMs, data, seq: this.seq++ };
    let i = this.queue.length;
    while (i > 0 && before(entry, this.queue[i - 1]!) < 0) i--;
    this.queue.splice(i, 0, entry);
    if (i === 0) this.arm();
  }

  /** (Re)arm the one timer for the head of the queue. */
  private arm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const head = this.queue[0];
    if (!head) return;
    this.timer = setTimeout(() => this.flush(), Math.max(0, head.at - performance.now()));
  }

  /** Send the head and everything due with it, in delivery order, then arm for what is left. */
  private flush(): void {
    this.timer = null;
    const head = this.queue[0];
    if (!head) return;
    const limit = head.at + FLUSH_WINDOW_MS;
    while (this.queue.length && this.queue[0]!.at <= limit) {
      const { data } = this.queue.shift()!;
      this.track(data);
      this.transmit(data);
    }
    this.arm();
  }

  private track(data: number[]): void {
    const [status, pitch, velocity] = data;
    if (status === undefined || pitch === undefined) return;
    if ((status & 0xf0) === NOTE_ON && (velocity ?? 0) > 0) this.sounding.add(pitch);
    else if ((status & 0xf0) === NOTE_OFF || ((status & 0xf0) === NOTE_ON && velocity === 0)) this.sounding.delete(pitch);
  }

  /** Cancel everything pending and release everything sounding. */
  panic(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
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
