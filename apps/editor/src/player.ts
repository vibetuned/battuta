/**
 * Page-view score player — a SCHEDULER over a performance. It plays what
 * `performance.ts` built from the host's timemap and notation facts, on
 * one of two sinks: its own Tone.Sampler (a self-hosted Salamander piano
 * subset, ~2MB, every third semitone — the sampler pitch-shifts between)
 * connected to the host's AudioContext, or the host's MIDI outputs. Audio
 * and the notation highlight ride the same wall clock, so they cannot
 * drift.
 *
 * Since slice 7a the host owns only the AudioContext (`host.audio`) and
 * the highlight (`host.view`); everything about HOW the score sounds —
 * the performance, the instrument, the transport — is here, and moves
 * into the playback plugin in 7b. No Tone transport: notes and cues are
 * scheduled a lookahead ahead from `performance.now()`, attacks converted
 * to the audio clock with `host.audio.timeAt`, MIDI sends handed to the
 * sink with the same wall-clock instant.
 */
import * as Tone from "tone";
import type { MidiOutputs } from "@battuta/api";
import { host } from "./host";
import { NOTE_ON, NOTE_OFF } from "./host/midiSink";
import type { Performance } from "./performance";

// Vite inlines these as hashed asset URLs — embedded in the app bundle,
// never a CDN (local-first, and the Tauri custom protocol serves them).
const SAMPLE_FILES = import.meta.glob("./assets/salamander/*.mp3", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** "./assets/salamander/Ds4.mp3" -> "D#4" (Tone.Sampler note names). */
const sampleUrls = (): Record<string, string> => {
  const urls: Record<string, string> = {};
  for (const [path, url] of Object.entries(SAMPLE_FILES)) {
    const m = /([A-G])(s?)(\d)\.mp3$/.exec(path);
    if (m) urls[`${m[1]}${m[2] ? "#" : ""}${m[3]}`] = url;
  }
  return urls;
};

// The shell smoke probes one sample through decodeAudioData: WebKitGTK's
// mp3 support rides gstreamer plugins, so it must be VERIFIED, not assumed.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>)["__SAMPLE_URL__"] = Object.values(SAMPLE_FILES)[0];
}

export type PlayerState = "idle" | "loading" | "playing" | "paused";

/** How far ahead of the wall clock notes and cues are handed to the sinks. */
const LOOKAHEAD_MS = 250;
/** How often the scheduler looks. */
const TICK_MS = 50;
/** Silence after the last stamp before the player stops itself. */
const TAIL_MS = 600;
const VELOCITY = 0.8;
const MIDI_VELOCITY = 102; // the sampler's 0.8

/** One playing stretch: its wall-clock anchor and how far into the performance it has scheduled. */
interface Run {
  /** performance.now() when this stretch started. */
  startWall: number;
  /** Listening position (ms, at the current speed) when it started. */
  startPos: number;
  nextNote: number;
  nextCue: number;
  timers: Set<ReturnType<typeof setTimeout>>;
  ticker: ReturnType<typeof setInterval> | null;
}

export class ScorePlayer {
  private sampler: Tone.Sampler | null = null;
  private state: PlayerState = "idle";
  private perf: Performance | null = null;
  private run: Run | null = null;
  /** Listening position (ms) while not running: paused, or 0. */
  private pausedPos = 0;
  private factor = 1; // tempo multiplier: 2 = double speed

  onStateChange: (s: PlayerState) => void = () => undefined;

  private setState(s: PlayerState) {
    this.state = s;
    this.onStateChange(s);
  }

  /** Unlock the host's AudioContext. Call this FIRST inside the click
   * handler, before any await — autoplay policies tie the unlock to the
   * gesture, and a slow timemap render could outlive the activation window. */
  unlock(): Promise<void> {
    return host.audio.unlock();
  }

  private ensureSampler(): Promise<Tone.Sampler> {
    if (this.sampler) return Promise.resolve(this.sampler);
    // The host's context, not one of Tone's own: every sound in the app
    // shares the one unlock.
    const ctx = host.audio.context();
    if (ctx && Tone.getContext().rawContext !== ctx) Tone.setContext(ctx);
    return new Promise((resolve, reject) => {
      const sampler = new Tone.Sampler({
        urls: sampleUrls(),
        onload: () => {
          this.sampler = sampler;
          resolve(sampler);
        },
        onerror: (e) => reject(e),
      }).toDestination();
    });
  }

  /** When set, playback SENDS MIDI here instead of sounding the sampler
   * (the performance drives both identically). */
  private midiSink: MidiOutputs | null = null;

  setMidiSink(sink: MidiOutputs | null): void {
    this.midiSink?.panic();
    this.midiSink = sink;
  }

  /** Semitone offset on the MIDI SENDS only (the sampler is untouched);
   * applies live — the scheduler reads it per attack, and each attack's
   * note-off is scheduled with the same pitch, so a mid-playback change
   * can never strand a note. */
  private midiTranspose = 0;
  setMidiTranspose(semitones: number): void {
    this.midiTranspose = semitones;
  }

  /** Musical length of the loaded score in seconds (tempo-independent). */
  musicalTotal(): number {
    return (this.perf?.totalMs ?? 0) / 1000;
  }

  /** Listening length at the current tempo. */
  total(): number {
    return this.musicalTotal() / this.factor;
  }

  /** Current position in LISTENING seconds at the current tempo. */
  position(): number {
    if (this.state === "idle" || this.state === "loading") return 0;
    return Math.min(this.total(), Math.max(0, this.positionMs() / 1000));
  }

  private positionMs(): number {
    return this.run ? this.run.startPos + (performance.now() - this.run.startWall) : this.pausedPos;
  }

  get tempo(): number {
    return this.factor;
  }

  /** Start a stretch from a listening position: schedule from there, on the wall clock. */
  private startRun(fromListeningMs: number): void {
    const perf = this.perf!;
    const musicalFrom = fromListeningMs * this.factor;
    const run: Run = {
      startWall: performance.now(),
      startPos: fromListeningMs,
      nextNote: perf.notes.findIndex((n) => n.onMs >= musicalFrom),
      nextCue: perf.cues.findIndex((c) => c.atMs >= musicalFrom),
      timers: new Set(),
      ticker: null,
    };
    if (run.nextNote < 0) run.nextNote = perf.notes.length;
    if (run.nextCue < 0) run.nextCue = perf.cues.length;
    this.run = run;
    run.ticker = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** Hand everything due within the lookahead to the sinks and the highlight. */
  private tick(): void {
    const run = this.run;
    const perf = this.perf;
    if (!run || !perf) return;
    const now = performance.now();
    const f = this.factor;
    const horizonMusical = (run.startPos + (now - run.startWall) + LOOKAHEAD_MS) * f;
    /** The wall-clock instant a musical stamp lands at, in this stretch. */
    const wallFor = (musicalMs: number): number => run.startWall + (musicalMs / f - run.startPos);
    while (run.nextNote < perf.notes.length && perf.notes[run.nextNote]!.onMs <= horizonMusical) {
      const n = perf.notes[run.nextNote++]!;
      const at = wallFor(n.onMs);
      const durMs = n.durMs / f;
      if (this.midiSink) {
        const pitch = Math.min(127, Math.max(0, n.pitch + this.midiTranspose));
        this.midiSink.schedule([NOTE_ON, pitch, MIDI_VELOCITY], at);
        this.midiSink.schedule([NOTE_OFF, pitch, 0], at + durMs);
      } else if (this.sampler) {
        this.sampler.triggerAttackRelease(Tone.Frequency(n.pitch, "midi").toFrequency(), durMs / 1000, host.audio.timeAt(at), VELOCITY);
      }
    }
    while (run.nextCue < perf.cues.length && perf.cues[run.nextCue]!.atMs <= horizonMusical) {
      const cue = perf.cues[run.nextCue++]!;
      const t = setTimeout(
        () => {
          run.timers.delete(t);
          if (this.state === "playing" && this.run === run) host.view.highlight(cue);
        },
        Math.max(0, wallFor(cue.atMs) - now),
      );
      run.timers.add(t);
    }
    if (run.nextNote >= perf.notes.length && run.nextCue >= perf.cues.length) {
      // Everything is handed out: stop after the last stamp plus a tail.
      if (run.ticker) clearInterval(run.ticker);
      run.ticker = null;
      const t = setTimeout(() => {
        run.timers.delete(t);
        if (this.run === run) this.stop();
      }, Math.max(0, wallFor(perf.totalMs) + TAIL_MS - now));
      run.timers.add(t);
    }
  }

  /** End the current stretch: cancel what is not yet delivered; remember where we were. */
  private endRun(): void {
    const run = this.run;
    if (!run) return;
    this.pausedPos = this.positionMs();
    for (const t of run.timers) clearTimeout(t);
    run.timers.clear();
    if (run.ticker) clearInterval(run.ticker);
    this.run = null;
  }

  /** Release everything sounding on either sink. Never throws onto the editing path. */
  private silence(): void {
    this.midiSink?.panic();
    try {
      this.sampler?.releaseAll();
    } catch {
      /* an audio-stack failure must not poison the caller */
    }
  }

  /** Start playback from the top. Must be called from a user gesture (the
   * play button) — the AudioContext unlock depends on it. */
  async play(perf: Performance): Promise<void> {
    this.stop();
    this.setState("loading");
    try {
      await host.audio.unlock(); // resume the context inside the gesture
      // MIDI destination: the 2 MB piano never has to load.
      if (!this.midiSink) await this.ensureSampler();
      this.perf = perf;
      if (perf.notes.length === 0 && perf.cues.length === 0) {
        this.setState("idle");
        return;
      }
      this.pausedPos = 0;
      this.startRun(0);
      this.setState("playing");
    } catch (e) {
      this.setState("idle");
      throw e;
    }
  }

  /** Jump to a fraction [0..1] of the piece; keeps playing/paused state. */
  seek(fraction: number): void {
    if (this.state === "idle" || this.state === "loading" || !this.perf) return;
    const target = Math.min(0.999, Math.max(0, fraction)) * this.total() * 1000;
    const wasPlaying = this.run !== null;
    this.endRun();
    this.silence(); // pending sends and sounding notes belong to the old position
    host.view.clearHighlight(); // stale lit notes: clear, the next cues relight
    this.pausedPos = target;
    if (wasPlaying) this.startRun(target);
  }

  /** Change the tempo multiplier; live — the schedule is rebuilt at the
   * current musical position (a rescheduling blip on sustained notes is
   * the price of exact timing). */
  setTempo(f: number): void {
    if (f === this.factor) return;
    if (this.state === "idle" || this.state === "loading" || !this.perf) {
      this.factor = f;
      return;
    }
    const wasPlaying = this.run !== null;
    const musicalPos = this.positionMs() * this.factor;
    this.endRun();
    this.silence(); // pending sends belong to the OLD schedule
    this.factor = f;
    this.pausedPos = musicalPos / f;
    host.view.clearHighlight();
    if (wasPlaying) this.startRun(this.pausedPos);
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.endRun();
    this.silence(); // never leave a note hanging on a synth
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.startRun(this.pausedPos);
    this.setState("playing");
  }

  stop(): void {
    // afterCommand calls this on EVERY edit. When nothing is scheduled
    // (never played, or already stopped) it must be a PURE no-op — no
    // audio stack is touched on the editing path.
    if (this.state === "idle" && !this.run) return;
    this.endRun();
    this.silence();
    this.pausedPos = 0;
    if (this.state !== "idle") this.setState("idle");
    host.view.clearHighlight();
  }
}

/** One player for the app — playback is inherently a singleton resource. */
export const scorePlayer = new ScorePlayer();
