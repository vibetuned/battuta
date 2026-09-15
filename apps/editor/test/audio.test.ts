/**
 * The audio host service over a fake AudioContext: the app's one context,
 * created on the first unlock — synchronously, so it happens inside the
 * click that asked — resumed on every unlock, handed out as is, and a
 * wall-clock → audio-clock conversion for schedulers that work from
 * `performance.now()` like the MIDI sink does.
 */
import { describe, it, expect, vi } from "vitest";
import { HostAudioService } from "../src/host/audio";

function fakeContext(state: AudioContextState = "suspended") {
  const ctx = {
    state,
    currentTime: 10,
    resume: vi.fn(async () => {
      ctx.state = "running";
    }),
  };
  return ctx as unknown as AudioContext & { resume: ReturnType<typeof vi.fn> };
}

describe("HostAudioService", () => {
  it("creates the context once, synchronously, on the first unlock; every unlock resumes it", async () => {
    const ctx = fakeContext();
    const create = vi.fn(() => ctx);
    const audio = new HostAudioService(create);
    expect(audio.context()).toBeNull();
    const p = audio.unlock();
    expect(create).toHaveBeenCalledTimes(1);
    expect(audio.context()).toBe(ctx); // before the promise settles: inside the gesture
    await p;
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    await audio.unlock();
    expect(create).toHaveBeenCalledTimes(1);
    expect(ctx.resume).toHaveBeenCalledTimes(1); // already running: nothing to resume
    ctx.state = "suspended";
    await audio.unlock();
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it("a failed resume does not throw at the caller", async () => {
    const ctx = fakeContext();
    ctx.resume = vi.fn(async () => {
      throw new Error("no gesture");
    });
    const audio = new HostAudioService(() => ctx);
    await expect(audio.unlock()).resolves.toBeUndefined();
  });

  it("answers null where the platform has no Web Audio, and unlock() is then a no-op", async () => {
    const audio = new HostAudioService(() => null);
    await expect(audio.unlock()).resolves.toBeUndefined();
    expect(audio.context()).toBeNull();
    expect(audio.timeAt(performance.now() + 1000)).toBeCloseTo(1, 1); // still a usable offset
  });

  it("timeAt converts the wall clock to the context's seconds; past instants land now", async () => {
    const ctx = fakeContext("running");
    const audio = new HostAudioService(() => ctx);
    await audio.unlock();
    const now = performance.now();
    expect(audio.timeAt(now + 250)).toBeCloseTo(10.25, 2);
    expect(audio.timeAt(now - 5000)).toBeCloseTo(10, 2);
  });
});
