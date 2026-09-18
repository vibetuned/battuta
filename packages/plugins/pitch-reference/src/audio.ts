/**
 * From a file to the samples the detector reads: the host's AudioContext
 * decodes it (decoding is a method on the context; the host owns the
 * context, this plugin makes no sound), the channels are averaged into
 * one, and the result is brought to the analysis rate. Pure functions
 * except `decodeForAnalysis`, so every step is testable on arrays.
 */
export const ANALYSIS_RATE = 16000;

/** Average the channels into one. */
export function downmix(channels: readonly Float32Array[]): Float32Array {
  const n = channels[0]?.length ?? 0;
  const out = new Float32Array(n);
  if (channels.length === 0) return out;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i]! += (ch[i] ?? 0) / channels.length;
  return out;
}

/**
 * Change the rate. Down: a box average over each output sample's span —
 * a decimator whose aliasing is negligible for pitches below 2 kHz at
 * 16 kHz, and no filter to get wrong. Up (rare — a low-rate file):
 * linear interpolation.
 */
export function resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const n = Math.floor(samples.length / ratio);
  const out = new Float32Array(n);
  if (ratio > 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio);
      const b = Math.min(samples.length, Math.floor((i + 1) * ratio));
      let s = 0;
      for (let j = a; j < b; j++) s += samples[j]!;
      out[i] = b > a ? s / (b - a) : 0;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const p = i * ratio;
      const j = Math.floor(p);
      const f = p - j;
      const s0 = samples[j] ?? 0;
      const s1 = samples[j + 1] ?? s0;
      out[i] = s0 * (1 - f) + s1 * f;
    }
  }
  return out;
}

/** The peak of each of `buckets` equal spans — a waveform strip. */
export function envelope(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(Math.max(0, buckets));
  if (buckets <= 0 || samples.length === 0) return out;
  const span = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * span);
    const to = Math.min(samples.length, Math.max(from + 1, Math.floor((b + 1) * span)));
    let peak = 0;
    for (let i = from; i < to; i++) {
      const v = Math.abs(samples[i]!);
      if (v > peak) peak = v;
    }
    out[b] = peak;
  }
  return out;
}

export interface DecodedTake {
  /** Mono, at `sampleRate` — what the detector reads. */
  samples: Float32Array;
  sampleRate: number;
  durationMs: number;
  /** The decoded recording as the browser gave it — what playback plays. */
  buffer: AudioBuffer;
}

/** Decode with the host's context (promise form, with the callback form for engines that only have that) and reduce to analysis-rate mono. */
export async function decodeForAnalysis(context: AudioContext, bytes: ArrayBuffer): Promise<DecodedTake> {
  const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
    const p = context.decodeAudioData(bytes, resolve, reject);
    if (p && typeof (p as Promise<AudioBuffer>).then === "function") (p as Promise<AudioBuffer>).then(resolve, reject);
  });
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const mono = downmix(channels);
  return { samples: resample(mono, buffer.sampleRate, ANALYSIS_RATE), sampleRate: ANALYSIS_RATE, durationMs: (buffer.length / buffer.sampleRate) * 1000, buffer };
}
