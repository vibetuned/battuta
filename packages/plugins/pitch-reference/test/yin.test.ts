/**
 * The detector on signals whose pitch is known: a sine reads its MIDI
 * number within ten cents, a jump reads both notes, silence and noise
 * are unvoiced, the median filter removes a one-frame blip and keeps a
 * gap, and the chunked analysis equals the whole-signal one.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_YIN, analysePitch, detectPitch, frameCount, hzToMidi, medianFilter, midiToHz, type PitchFrame } from "../src/yin";

const RATE = DEFAULT_YIN.sampleRate;

function sine(hz: number, seconds: number, amplitude = 0.5, rate = RATE): Float32Array {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

const concat = (...parts: Float32Array[]): Float32Array => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const voiced = (frames: PitchFrame[]): number[] => frames.flatMap((f) => (f.midi === null ? [] : [f.midi]));

describe("yin", () => {
  it("converts between Hz and MIDI", () => {
    expect(hzToMidi(440)).toBeCloseTo(69, 9);
    expect(midiToHz(69)).toBeCloseTo(440, 9);
    expect(hzToMidi(261.6256)).toBeCloseTo(60, 3);
  });

  it("reads a 440 Hz sine as A4 within ten cents on every frame", () => {
    const frames = detectPitch(sine(440, 1));
    expect(frames.length).toBe(frameCount(RATE, DEFAULT_YIN));
    expect(frames.length).toBeGreaterThan(80);
    const midis = voiced(frames);
    expect(midis.length).toBe(frames.length);
    for (const m of midis) expect(Math.abs(m - 69)).toBeLessThan(0.1);
    for (const f of frames) expect(f.confidence).toBeGreaterThan(0.8);
    expect(frames[0]!.t).toBeCloseTo(DEFAULT_YIN.window / 2 / RATE, 6);
  });

  it("reads a low note and an octave jump", () => {
    const frames = detectPitch(concat(sine(110, 0.5), sine(880, 0.5)));
    const early = voiced(frames.filter((f) => f.t < 0.4));
    const late = voiced(frames.filter((f) => f.t > 0.6));
    expect(early.length).toBeGreaterThan(20);
    expect(late.length).toBeGreaterThan(20);
    for (const m of early) expect(Math.abs(m - 45)).toBeLessThan(0.15);
    for (const m of late) expect(Math.abs(m - 81)).toBeLessThan(0.15);
  });

  it("calls silence and noise unvoiced", () => {
    expect(voiced(detectPitch(new Float32Array(RATE)))).toEqual([]);
    let seed = 12345;
    const noise = new Float32Array(RATE);
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = (seed / 0x7fffffff) * 0.6 - 0.3;
    }
    const frames = detectPitch(noise);
    expect(voiced(frames).length / frames.length).toBeLessThan(0.2);
  });

  it("the median filter removes a one-frame octave blip and keeps a gap", () => {
    const at = (i: number, midi: number | null): PitchFrame => ({ t: i / 100, midi, confidence: midi === null ? 0 : 0.9 });
    const frames = [at(0, 69), at(1, 69), at(2, 81), at(3, 69), at(4, 69), at(5, null), at(6, null), at(7, 71.02), at(8, 71), at(9, 70.98)];
    const out = medianFilter(frames, 5);
    expect(out.map((f) => f.midi)).toEqual([69, 69, 69, 69, 69, null, null, 71, 71, 71]);
    expect(out[5]!.midi).toBeNull();
  });

  it("the chunked analysis yields between chunks, reports progress and matches the whole-signal result", async () => {
    const samples = sine(330, 0.6);
    let yields = 0;
    const progress: number[] = [];
    const chunked = await analysePitch(samples, DEFAULT_YIN, {
      framesPerYield: 10,
      yield: async () => {
        yields++;
      },
      progress: (done, total) => progress.push(done / total),
    });
    expect(chunked).toEqual(detectPitch(samples));
    expect(yields).toBeGreaterThan(2);
    expect(progress[progress.length - 1]).toBe(1);
  });
});
