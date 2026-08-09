/**
 * Page-view score player: Verovio's timemap drives BOTH the audio and the
 * notation highlight from one timeline, so they cannot drift. Sound is a
 * Tone.Sampler over a self-hosted Salamander piano subset (~2MB, every
 * third semitone — the sampler pitch-shifts between); sounding pitch per
 * note id comes from Verovio (key signature, accidentals, ties resolved),
 * note lengths from the timemap's own on→off spans.
 */
import * as Tone from "tone";
import type { PlaybackData } from "./render/renderPool";

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

export class ScorePlayer {
  private sampler: Tone.Sampler | null = null;
  private part: Tone.Part<{ time: number; on: string[]; off: string[]; measureOn?: string }> | null = null;
  private state: PlayerState = "idle";

  onHighlight: (on: string[], off: string[], measureOn?: string) => void = () => undefined;
  onStateChange: (s: PlayerState) => void = () => undefined;

  private setState(s: PlayerState) {
    this.state = s;
    this.onStateChange(s);
  }

  private ensureSampler(): Promise<Tone.Sampler> {
    if (this.sampler) return Promise.resolve(this.sampler);
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

  /** Resume the AudioContext. Call this FIRST inside the click handler,
   * before any await — autoplay policies tie the unlock to the gesture,
   * and a slow timemap render could outlive the activation window. */
  unlock(): Promise<void> {
    return Tone.start();
  }

  private data: PlaybackData | null = null;
  private durMs = new Map<string, number>();
  private factor = 1; // tempo multiplier: 2 = double speed

  /** Musical length of the loaded score in seconds (tempo-independent). */
  musicalTotal(): number {
    const last = this.data?.events[this.data.events.length - 1];
    return last ? last.tstamp / 1000 : 0;
  }

  /** Listening length at the current tempo. */
  total(): number {
    return this.musicalTotal() / this.factor;
  }

  /** Current position in LISTENING seconds at the current tempo. */
  position(): number {
    if (this.state === "idle" || this.state === "loading") return 0;
    return Math.min(this.total(), Math.max(0, Tone.getTransport().seconds));
  }

  get tempo(): number {
    return this.factor;
  }

  /** Build + start the Part with event times scaled by the tempo factor.
   * The transport is assumed stopped/cancelled. */
  private schedulePart(sampler: Tone.Sampler): void {
    const data = this.data!;
    const f = this.factor;
    const events = data.events
      .filter((ev) => (ev.on?.length ?? 0) + (ev.off?.length ?? 0) > 0 || ev.measureOn)
      .map((ev) => ({ time: ev.tstamp / 1000 / f, on: ev.on ?? [], off: ev.off ?? [], ...(ev.measureOn ? { measureOn: ev.measureOn } : {}) }));
    // Audio plays the raw (possibly cloned) ids; the HIGHLIGHT maps every
    // id back to the notated one — the SVG only contains those, so
    // repeated passes light the same engraved notes.
    const vis = (id: string): string => data.idMap[id] ?? id;
    this.part = new Tone.Part((time, ev) => {
      for (const id of ev.on) {
        const note = data.notes[id];
        if (note) sampler.triggerAttackRelease(Tone.Frequency(note.pitch, "midi").toFrequency(), (this.durMs.get(id) ?? 300) / 1000 / f, time, 0.8);
      }
      Tone.getDraw().schedule(() => {
        if (this.state === "playing") this.onHighlight(ev.on.map(vis), ev.off.map(vis), ev.measureOn ? vis(ev.measureOn) : undefined);
      }, time);
    }, events);
    this.part.start(0);
    Tone.getTransport().scheduleOnce(() => this.stop(), (this.musicalTotal() + 0.6) / f);
  }

  /** Start playback from the top. Must be called from a user gesture (the
   * play button) — the AudioContext unlock depends on it. */
  async play(data: PlaybackData): Promise<void> {
    this.stop();
    this.setState("loading");
    try {
      await Tone.start(); // resume the AudioContext inside the gesture
      const sampler = await this.ensureSampler();

      // Note lengths from the timemap itself: an id's off minus its on.
      // (Tied continuations never re-appear in "on", so a held note sounds
      // exactly once for its full written span.)
      const onAt = new Map<string, number>();
      this.durMs = new Map<string, number>();
      for (const ev of data.events) {
        for (const id of ev.on ?? []) if (!onAt.has(id)) onAt.set(id, ev.tstamp);
        for (const id of ev.off ?? []) {
          const t0 = onAt.get(id);
          if (t0 !== undefined && !this.durMs.has(id)) this.durMs.set(id, Math.max(60, ev.tstamp - t0));
        }
      }
      this.data = data;
      if (data.events.length === 0) {
        this.setState("idle");
        return;
      }
      this.schedulePart(sampler);
      Tone.getTransport().start();
      this.setState("playing");
    } catch (e) {
      this.setState("idle");
      throw e;
    }
  }

  /** Jump to a fraction [0..1] of the piece; keeps playing/paused state. */
  seek(fraction: number): void {
    if (this.state === "idle" || this.state === "loading" || !this.data) return;
    const target = Math.min(0.999, Math.max(0, fraction)) * this.total();
    Tone.getTransport().seconds = target;
    this.onHighlight([], [], undefined); // stale lit notes: clear, next events relight
  }

  /** Change the tempo multiplier; live — the schedule is rebuilt at the
   * current musical position (a rescheduling blip on sustained notes is
   * the price of exact timing). */
  setTempo(f: number): void {
    if (f === this.factor) return;
    if (this.state === "idle" || this.state === "loading" || !this.data || !this.sampler) {
      this.factor = f;
      return;
    }
    const wasPlaying = this.state === "playing";
    const musicalPos = this.position() * this.factor;
    const transport = Tone.getTransport();
    transport.pause();
    transport.cancel(0);
    this.part?.dispose();
    this.factor = f;
    this.schedulePart(this.sampler);
    transport.seconds = musicalPos / f;
    this.onHighlight([], [], undefined);
    if (wasPlaying) transport.start();
  }

  pause(): void {
    if (this.state !== "playing") return;
    Tone.getTransport().pause();
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused") return;
    Tone.getTransport().start();
    this.setState("playing");
  }

  stop(): void {
    // afterCommand calls this on EVERY edit. When nothing is scheduled
    // (never played, or already stopped) it must be a PURE no-op — even
    // touching Tone.getTransport() lazily builds the audio stack, and that
    // work has no business on the editing path.
    if (this.state === "idle" && !this.part) return;
    // An audio-stack failure below must never poison the editing path.
    try {
      const transport = Tone.getTransport();
      transport.stop();
      transport.cancel(0);
      this.part?.dispose();
      this.part = null;
    } catch {
      this.part = null;
    }
    if (this.state !== "idle") this.setState("idle");
    this.onHighlight([], [], undefined); // signal: clear everything
  }
}

/** One player for the app — playback is inherently a singleton resource. */
export const scorePlayer = new ScorePlayer();
