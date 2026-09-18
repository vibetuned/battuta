/**
 * The road from a decoded buffer to the detector's samples: channels
 * averaged, the rate changed without moving the pitch, the envelope's
 * peaks — and the decode through a context-shaped fake.
 */
import { describe, it, expect } from "vitest";
import { ANALYSIS_RATE, decodeForAnalysis, downmix, envelope, resample } from "../src/audio";
import { detectPitch } from "../src/yin";

const sine = (hz: number, seconds: number, rate: number): Float32Array => {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
};

describe("audio", () => {
  it("downmix averages the channels", () => {
    const out = downmix([new Float32Array([1, 1, 1]), new Float32Array([0, 0, -1])]);
    expect([...out]).toEqual([0.5, 0.5, 0]);
    expect(downmix([]).length).toBe(0);
  });

  it("resample keeps a constant and the duration, and leaves the pitch where it was", () => {
    const dc = resample(new Float32Array(48000).fill(0.3), 48000, 16000);
    expect(dc.length).toBe(16000);
    for (const v of dc) expect(v).toBeCloseTo(0.3, 6);
    const down = resample(sine(440, 1, 44100), 44100, ANALYSIS_RATE);
    expect(Math.abs(down.length - ANALYSIS_RATE)).toBeLessThanOrEqual(1);
    const midis = detectPitch(down).flatMap((f) => (f.midi === null ? [] : [f.midi]));
    expect(midis.length).toBeGreaterThan(80);
    for (const m of midis) expect(Math.abs(m - 69)).toBeLessThan(0.1);
    const up = resample(sine(440, 1, 8000), 8000, ANALYSIS_RATE);
    expect(up.length).toBe(ANALYSIS_RATE);
    expect(resample(dc, 16000, 16000)).toBe(dc);
  });

  it("envelope takes the peak of each span", () => {
    const ramp = new Float32Array(1000);
    for (let i = 0; i < ramp.length; i++) ramp[i] = (i % 2 ? -1 : 1) * (i / 1000);
    const env = envelope(ramp, 10);
    expect(env.length).toBe(10);
    for (let b = 1; b < 10; b++) expect(env[b]!).toBeGreaterThan(env[b - 1]!);
    expect(env[9]).toBeCloseTo(0.999, 3);
    expect(envelope(new Float32Array(0), 5).length).toBe(5);
  });

  it("decodeForAnalysis decodes through the context and hands back analysis-rate mono", async () => {
    const left = sine(440, 0.5, 48000);
    const buffer = { sampleRate: 48000, numberOfChannels: 2, length: left.length, duration: 0.5, getChannelData: (c: number) => (c === 0 ? left : new Float32Array(left.length)) };
    const context = { decodeAudioData: async () => buffer } as unknown as AudioContext;
    const take = await decodeForAnalysis(context, new ArrayBuffer(8));
    expect(take.sampleRate).toBe(ANALYSIS_RATE);
    expect(take.durationMs).toBe(500);
    expect(take.samples.length).toBe(8000);
    // half amplitude (one silent channel), same pitch
    const midis = detectPitch(take.samples).flatMap((f) => (f.midi === null ? [] : [f.midi]));
    expect(midis.length).toBeGreaterThan(30);
    for (const m of midis) expect(Math.abs(m - 69)).toBeLessThan(0.1);
  });
});
