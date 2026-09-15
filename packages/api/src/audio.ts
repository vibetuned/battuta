/**
 * The audio host service (capability "audio"): the app's ONE Web Audio
 * context. The host owns the context, not an instrument — a plugin brings
 * its own synth or sampler and connects it here, so a player, a
 * metronome and a note preview share one context and never fight over
 * the autoplay unlock.
 *
 * `unlock()` must be called inside a user gesture, before any `await` —
 * browsers bind the AudioContext unlock to the click that caused it. The
 * host creates the context on the first call and resumes it on every one.
 */
export interface AudioService {
  /** Create (once) and resume the shared context. Call it in the click handler, first thing. Resolves once running; resolves too where the platform has no Web Audio. */
  unlock(): Promise<void>;
  /** The shared context — null before the first unlock, and where the platform has none (tests, a headless shell). */
  context(): AudioContext | null;
  /**
   * The `performance.now()` clock in the context's seconds: schedule an
   * attack for a wall-clock instant sample-accurately, the way a MIDI sink
   * schedules a send (`MidiOutputs.schedule` takes the same `atMs`).
   */
  timeAt(atMs: number): number;
}
