/**
 * Pitch detection: plain YIN (de Cheveigné & Kawahara, 2002), hand-rolled
 * over a Float32Array, no dependency. Monophonic by design — a voice, one
 * instrument: the reference this plugin traces. A frame the detector
 * cannot call periodic is UNVOICED (`midi: null`) and stays a gap in the
 * trace; a median filter over the voiced neighbours removes the one-frame
 * blips an octave error leaves. Pitch comes out as fractional MIDI, the
 * axis the written notes are on.
 *
 * Cost: window × lags per frame (1024 × 320 at the defaults), about a
 * third of a second of plain JS per ten seconds of audio — `analysePitch`
 * yields between chunks so the editor never waits on it.
 */
export interface YinOptions {
  /** Hz of the samples handed in. */
  sampleRate: number;
  /** Samples per frame — the integration window W. */
  window: number;
  /** Samples between frame starts. */
  hop: number;
  /** The lowest pitch looked for: sets the largest lag. */
  minHz: number;
  /** The highest pitch looked for: sets the smallest lag. */
  maxHz: number;
  /** The absolute threshold on the normalised difference d′; higher admits noisier frames. */
  threshold: number;
  /** RMS below which a frame is unvoiced without looking (silence). */
  silence: number;
}

/** 16 kHz mono: a 64 ms window, a 10 ms hop (100 frames a second), 50 Hz to 2 kHz. */
export const DEFAULT_YIN: YinOptions = { sampleRate: 16000, window: 1024, hop: 160, minHz: 50, maxHz: 2000, threshold: 0.15, silence: 0.01 };

export interface PitchFrame {
  /** Seconds from the start of the audio, at the frame's centre. */
  t: number;
  /** Fractional MIDI, or null when the frame is unvoiced. */
  midi: number | null;
  /** 1 − d′ at the chosen lag: how periodic the frame was; 0 for an unvoiced one. */
  confidence: number;
}

export const hzToMidi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

const maxLag = (opts: YinOptions): number => Math.floor(opts.sampleRate / opts.minHz);

/** Frames the analysis produces for `n` samples: one per hop while a full frame (window + largest lag) fits. */
export function frameCount(n: number, opts: YinOptions = DEFAULT_YIN): number {
  const need = opts.window + maxLag(opts);
  return n < need ? 0 : Math.floor((n - need) / opts.hop) + 1;
}

/**
 * One frame, steps 1–5 of the paper: the difference function over the
 * lags of the pitch range, its cumulative mean normalisation, the first
 * lag under the threshold walked down to its local minimum (none: the
 * frame is unvoiced), and a parabola through the minimum for a
 * sub-sample lag. `scratch` is a reusable buffer of at least maxLag + 1.
 */
export function yinFrame(x: Float32Array, start: number, opts: YinOptions, scratch: Float32Array): { hz: number | null; aperiodicity: number } {
  const W = opts.window;
  const tauMax = Math.min(maxLag(opts), x.length - start - W);
  const tauMin = Math.max(2, Math.floor(opts.sampleRate / opts.maxHz));
  if (tauMax <= tauMin) return { hz: null, aperiodicity: 1 };
  let energy = 0;
  for (let j = 0; j < W; j++) {
    const v = x[start + j]!;
    energy += v * v;
  }
  if (Math.sqrt(energy / W) < opts.silence) return { hz: null, aperiodicity: 1 };
  const d = scratch;
  // step 2: the difference function
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    const b = start + tau;
    for (let j = 0; j < W; j++) {
      const diff = x[start + j]! - x[b + j]!;
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // step 3: cumulative mean normalised difference d′
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau]!;
    d[tau] = running > 0 ? (d[tau]! * tau) / running : 1;
  }
  // step 4: the absolute threshold, then down to the local minimum
  let tau = -1;
  for (let k = tauMin; k <= tauMax; k++) {
    if (d[k]! < opts.threshold) {
      while (k + 1 <= tauMax && d[k + 1]! < d[k]!) k++;
      tau = k;
      break;
    }
  }
  if (tau < 0) {
    let best = tauMin;
    for (let k = tauMin + 1; k <= tauMax; k++) if (d[k]! < d[best]!) best = k;
    return { hz: null, aperiodicity: d[best]! };
  }
  // step 5: a parabola through the minimum and its neighbours
  let refined = tau;
  if (tau > tauMin && tau < tauMax) {
    const s0 = d[tau - 1]!;
    const s1 = d[tau]!;
    const s2 = d[tau + 1]!;
    const denom = s0 - 2 * s1 + s2;
    if (denom > 0) refined = tau + (s0 - s2) / (2 * denom);
  }
  return { hz: opts.sampleRate / refined, aperiodicity: d[tau]! };
}

const frameAt = (x: Float32Array, i: number, opts: YinOptions, scratch: Float32Array): PitchFrame => {
  const start = i * opts.hop;
  const r = yinFrame(x, start, opts, scratch);
  return { t: (start + opts.window / 2) / opts.sampleRate, midi: r.hz === null ? null : hzToMidi(r.hz), confidence: r.hz === null ? 0 : Math.max(0, Math.min(1, 1 - r.aperiodicity)) };
};

/** The whole signal at once — tests and short files. */
export function detectPitch(samples: Float32Array, opts: YinOptions = DEFAULT_YIN): PitchFrame[] {
  const n = frameCount(samples.length, opts);
  const scratch = new Float32Array(maxLag(opts) + 2);
  const out: PitchFrame[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = frameAt(samples, i, opts, scratch);
  return out;
}

export interface AnalysisHooks {
  /** Called between chunks; return a promise that resolves when the caller may continue (a `setTimeout(0)` lets the UI paint). */
  yield?: () => Promise<void>;
  progress?: (done: number, total: number) => void;
  /** Frames per chunk between yields (200 ≈ 50 ms of work at the defaults). */
  framesPerYield?: number;
}

/** The whole signal in chunks, yielding between them, so a long take never blocks the editor. */
export async function analysePitch(samples: Float32Array, opts: YinOptions = DEFAULT_YIN, hooks: AnalysisHooks = {}): Promise<PitchFrame[]> {
  const n = frameCount(samples.length, opts);
  const per = Math.max(1, hooks.framesPerYield ?? 200);
  const scratch = new Float32Array(maxLag(opts) + 2);
  const out: PitchFrame[] = [];
  for (let i = 0; i < n; i++) {
    out.push(frameAt(samples, i, opts, scratch));
    if ((i + 1) % per === 0 && i + 1 < n) {
      hooks.progress?.(i + 1, n);
      if (hooks.yield) await hooks.yield();
    }
  }
  hooks.progress?.(n, n);
  return out;
}

/**
 * A median over each voiced frame's voiced neighbours within `width`
 * frames: the one-frame octave blip goes, a gap stays a gap, and a real
 * change of note survives because the window is short.
 */
export function medianFilter(frames: readonly PitchFrame[], width = 5): PitchFrame[] {
  const half = Math.floor(width / 2);
  return frames.map((f, i) => {
    if (f.midi === null) return f;
    const around: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(frames.length - 1, i + half); j++) {
      const m = frames[j]!.midi;
      if (m !== null) around.push(m);
    }
    around.sort((a, b) => a - b);
    const mid = around.length >> 1;
    const median = around.length % 2 ? around[mid]! : (around[mid - 1]! + around[mid]!) / 2;
    return median === f.midi ? f : { ...f, midi: median };
  });
}
