/**
 * The take player over a context-shaped fake: a stretch starts at the
 * playhead and the position follows the context's clock; pause keeps the
 * position and a second play restarts there; the recording's own end
 * reports itself and a pause does not; no context or no recording means
 * no playback; loading a new take stops the old one.
 */
import { describe, it, expect, vi } from "vitest";
import type { AudioService } from "@battuta/api";
import { TakePlayer } from "../src/player";

function fakeAudio(opts: { context?: boolean } = {}) {
  const sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null; buffer: unknown }[] = [];
  const ctx = {
    currentTime: 0,
    destination: {},
    createBufferSource: () => {
      const s = { buffer: null as unknown, connect: () => undefined, disconnect: () => undefined, start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
      sources.push(s);
      return s;
    },
  };
  const unlocks = { n: 0 };
  const audio: AudioService = {
    unlock: async () => {
      unlocks.n++;
    },
    context: () => (opts.context === false ? null : (ctx as unknown as AudioContext)),
    timeAt: (ms) => ms / 1000,
  };
  return { audio, ctx, sources, unlocks };
}
const buffer = (seconds: number) => ({ duration: seconds } as unknown as AudioBuffer);

describe("TakePlayer", () => {
  it("plays from the playhead, follows the clock, pauses where it is and restarts there", async () => {
    const f = fakeAudio();
    const p = new TakePlayer(f.audio);
    p.load(buffer(10));
    expect(p.durationMs()).toBe(10000);
    expect(await p.play(1500)).toBe(true);
    expect(f.unlocks.n).toBe(1); // the unlock rides the gesture
    expect(p.playing).toBe(true);
    expect(f.sources[0]!.start).toHaveBeenCalledWith(0, 1.5);
    f.ctx.currentTime = 2;
    expect(p.position()).toBeCloseTo(3500, 6);
    expect(p.pause()).toBeCloseTo(3500, 6);
    expect(p.playing).toBe(false);
    expect(f.sources[0]!.stop).toHaveBeenCalledTimes(1);
    expect(p.position()).toBeCloseTo(3500, 6); // held while paused
    await p.play(p.position());
    expect(f.sources[1]!.start).toHaveBeenCalledWith(0, 3.5);
    f.ctx.currentTime = 12;
    expect(p.position()).toBe(10000); // never past the end
  });

  it("reports the recording's end, and not a pause", async () => {
    const f = fakeAudio();
    const p = new TakePlayer(f.audio);
    const ended = vi.fn();
    p.onEnded = ended;
    p.load(buffer(1));
    await p.play(0);
    p.pause();
    expect(ended).not.toHaveBeenCalled();
    await p.play(0);
    f.ctx.currentTime = 1;
    f.sources[1]!.onended?.(); // the browser says it played through
    expect(ended).toHaveBeenCalledTimes(1);
    expect(p.playing).toBe(false);
    expect(p.position()).toBe(1000);
  });

  it("does not play without a context or a recording; a new take stops the old one", async () => {
    const none = new TakePlayer(fakeAudio({ context: false }).audio);
    none.load(buffer(1));
    expect(await none.play(0)).toBe(false);
    const f = fakeAudio();
    const p = new TakePlayer(f.audio);
    expect(await p.play(0)).toBe(false); // nothing loaded
    p.load(buffer(2));
    await p.play(500);
    p.load(buffer(3));
    expect(p.playing).toBe(false);
    expect(f.sources[0]!.stop).toHaveBeenCalledTimes(1);
    expect(p.position()).toBe(0);
  });
});
