/**
 * The audio host service: the app's ONE AudioContext (slice 7a,
 * 2026-09-15). The host owns the context — a platform capability, with
 * the autoplay unlock that only a user gesture can grant — and nothing
 * else: no instrument, no transport. A plugin connects its own sampler or
 * synth (the playback plugin brings Tone.js) and schedules against the
 * context's clock through `timeAt`, the way it schedules MIDI sends
 * against `performance.now()`.
 *
 * `unlock()` creates the context SYNCHRONOUSLY on its first call, so the
 * creation happens inside the click handler that invoked it (browsers
 * bind the unlock to the gesture); the resume it returns may take a tick.
 * The factory is injectable for tests and for platforms without Web
 * Audio, where the service answers null and the plugin falls back.
 */
import type { AudioService } from "@battuta/api";

export type AudioContextFactory = () => AudioContext | null;

const defaultFactory: AudioContextFactory = () => (typeof AudioContext === "undefined" ? null : new AudioContext());

export class HostAudioService implements AudioService {
  private ctx: AudioContext | null = null;

  constructor(private readonly create: AudioContextFactory = defaultFactory) {}

  unlock(): Promise<void> {
    if (!this.ctx) this.ctx = this.create();
    const c = this.ctx;
    if (!c) return Promise.resolve();
    if (c.state === "running") return Promise.resolve();
    // A failed resume is not fatal here: the caller's play() will surface
    // the silence as "nothing sounded", and a later gesture may succeed.
    return c.resume().catch(() => undefined);
  }

  context(): AudioContext | null {
    return this.ctx;
  }

  timeAt(atMs: number): number {
    const lead = Math.max(0, atMs - performance.now()) / 1000;
    return (this.ctx?.currentTime ?? 0) + lead;
  }
}
