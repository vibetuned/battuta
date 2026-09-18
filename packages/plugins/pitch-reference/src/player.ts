/**
 * Plays the loaded recording through the host's AudioContext: one buffer
 * source per stretch, started at the playhead, stopped on pause, the
 * position read from the context's clock. The host owns the context and
 * this plugin brings no instrument — it plays the user's own file, so a
 * take can be heard against the notation it is drawn on.
 */
import type { AudioService } from "@battuta/api";

export class TakePlayer {
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** The context's clock when the stretch began, and where in the recording. */
  private startedAt = 0;
  private fromMs = 0;
  /** Called when the recording plays through to its end (not on pause). */
  onEnded: (() => void) | null = null;

  constructor(private readonly audio: AudioService) {}

  /** Take a recording (or none); stops whatever was playing. */
  load(buffer: AudioBuffer | null): void {
    this.stop();
    this.buffer = buffer;
    this.fromMs = 0;
  }

  get playing(): boolean {
    return this.source !== null;
  }

  durationMs(): number {
    return this.buffer ? this.buffer.duration * 1000 : 0;
  }

  /**
   * Start — or restart — from `fromMs`. The unlock comes first, so a call
   * made in a click resumes the context inside the gesture. False where
   * there is no context or no recording.
   */
  async play(fromMs: number): Promise<boolean> {
    await this.audio.unlock();
    const ctx = this.audio.context();
    if (!ctx || !this.buffer) return false;
    this.stop();
    const at = Math.max(0, Math.min(fromMs, this.durationMs()));
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (this.source !== source) return; // a pause or a restart, not the end
      this.source = null;
      this.fromMs = this.durationMs();
      this.onEnded?.();
    };
    source.start(0, at / 1000);
    this.source = source;
    this.startedAt = ctx.currentTime;
    this.fromMs = at;
    return true;
  }

  /** Where playback is now, in ms of the recording — the start position when not playing. */
  position(): number {
    const ctx = this.audio.context();
    if (!this.source || !ctx) return this.fromMs;
    return Math.min(this.durationMs(), this.fromMs + (ctx.currentTime - this.startedAt) * 1000);
  }

  /** Stop and keep the position; returns it. */
  pause(): number {
    const pos = this.position();
    this.stop();
    this.fromMs = pos;
    return pos;
  }

  private stop(): void {
    const s = this.source;
    if (!s) return;
    this.source = null; // before stop(): its onended must not count as the end
    try {
      s.onended = null;
      s.stop();
      s.disconnect();
    } catch {
      /* already stopped */
    }
  }
}
