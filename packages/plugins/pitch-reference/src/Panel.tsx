/**
 * The bottom panel: the controls and the whole-file strip. Everything it
 * SHOWS arrives from the state store it subscribes to itself; everything
 * it DOES goes through `actions`, so a test reads the wiring straight off
 * the element `render()` returns and this file holds no audio call, no
 * storage write and no timemap read.
 *
 * The strip is one SVG whose viewBox is the recording's length in ms by
 * 100, stretched to the panel's width (`preserveAspectRatio="none"`), so
 * x IS wav time and no measuring is needed: the waveform, the written
 * notes through the alignment, the trace, a tick per measure. Clicking it
 * names where bar 1 begins.
 */
import type { CSSProperties, ChangeEvent, PointerEvent, ReactNode } from "react";
import { useRef } from "react";
import type { Store } from "@battuta/api";
import type { Alignment, Deviation, MeasureWindow, WrittenNote } from "./align";
import { toWavMs } from "./align";
import { useStore } from "./store";
import type { PitchFrame } from "./yin";

export type RefStatus = "empty" | "decoding" | "analysing" | "ready" | "error";

/** What the panel and the overlays draw. One object, so one subscription serves both. */
export interface RefState {
  status: RefStatus;
  fileName: string | null;
  durationMs: number;
  /** 0..1 while analysing. */
  progress: number;
  error: string | null;
  /** Peak per bucket of the recording, for the strip. */
  envelope: Float32Array | null;
  /** The trace as detected, median-filtered; empty until ready. */
  raw: readonly PitchFrame[];
  /** The trace as compared and drawn: `raw` shifted by `transpose`. */
  frames: readonly PitchFrame[];
  /** Semitones added to the detected pitch — a voice an octave below the written part sings −12. */
  transpose: number;
  alignment: Alignment;
  /** The "recorded at ♩=" the user typed; null means the score's tempo. */
  recordedTempo: number | null;
  /** The score's tempo the timemap runs at. */
  scoreTempo: number;
  /** Draw on the measure tiles too. */
  showOverlays: boolean;
  /** The decoded recording, kept for playback while the take is loaded. */
  buffer: AudioBuffer | null;
  /** The recording is sounding. */
  playing: boolean;
  /** The written notes are sounding through MIDI. */
  playingScore: boolean;
  /** Where playback starts — or is, while playing — in ms of the recording. The white line. */
  playheadMs: number;
  /** Onset of every timemap id (notes AND rests), score ms: the caret's event finds its moment here. */
  onsets: Readonly<Record<string, number>>;
  written: readonly WrittenNote[];
  measures: readonly MeasureWindow[];
  deviation: Deviation | null;
}

/** A file as the panel hands it over: the name and the bytes, nothing of the DOM's File. */
export interface TakeFile {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface PanelActions {
  /** FIRST in the click that opens the file dialog: the host's AudioContext unlock rides on the gesture. */
  unlock(): void;
  load(file: TakeFile): void;
  clear(): void;
  setOffset(ms: number): void;
  setRecordedTempo(bpm: number | null): void;
  setTranspose(semitones: number): void;
  setShowOverlays(on: boolean): void;
  /** Play the recording from the playhead, or pause where it is. */
  playPause(): void;
  /** Play the written notes through the MIDI outputs from the playhead, or pause them. */
  playPauseScore(): void;
  /** Move the playhead (ms of the recording); a playing take jumps there. */
  seek(ms: number): void;
  close(): void;
}

export interface PanelProps {
  state: Store<RefState>;
  actions: PanelActions;
}

const ROOT: CSSProperties = { padding: "6px 10px 8px", fontSize: 12, color: "#dde" };
const ROW: CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 };
const BTN: CSSProperties = { font: "inherit", fontSize: 12, padding: "2px 8px", background: "#2c3745", color: "#dde", border: "1px solid #4a5768", borderRadius: 3, cursor: "pointer" };
const NUM: CSSProperties = { font: "inherit", fontSize: 12, width: 64, background: "#161d27", color: "#dde", border: "1px solid #4a5768", borderRadius: 3, padding: "1px 4px" };
const DIM: CSSProperties = { color: "#9ab" };
const STRIP: CSSProperties = { display: "block", width: "100%", height: 120, background: "#161d27", borderRadius: 3, cursor: "col-resize", touchAction: "none" };
const HINT: CSSProperties = { ...STRIP, cursor: "default", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ab" };

/** The pitch range the strip shows: what was written and what was sung, with a tone of margin; a fifth-less default. */
export function pitchRange(written: readonly WrittenNote[], frames: readonly PitchFrame[]): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of written) {
    lo = Math.min(lo, n.midi);
    hi = Math.max(hi, n.midi);
  }
  for (const f of frames) {
    if (f.midi === null) continue;
    lo = Math.min(lo, f.midi);
    hi = Math.max(hi, f.midi);
  }
  if (lo === Infinity) return { lo: 48, hi: 84 };
  return { lo: Math.floor(lo) - 2, hi: Math.ceil(hi) + 2 };
}

/** Between two consecutive voiced frames, a jump of more than this is a new note (or an octave error), not a glide: the pen lifts rather than draw a wall. */
export const LEAP_SEMITONES = 6;

/** The trace as SVG path data: a segment per run of voiced frames, gaps where the frame was unvoiced or the pitch leapt. */
export function tracePath(frames: readonly PitchFrame[], x: (tMs: number) => number, y: (midi: number) => number): string {
  let d = "";
  let pen = false;
  let last: number | null = null;
  for (const f of frames) {
    if (f.midi === null) {
      pen = false;
      last = null;
      continue;
    }
    if (pen && last !== null && Math.abs(f.midi - last) > LEAP_SEMITONES) pen = false;
    d += `${pen ? "L" : "M"}${x(f.t * 1000).toFixed(1)} ${y(f.midi).toFixed(2)}`;
    pen = true;
    last = f.midi;
  }
  return d;
}

/** The line the notice shows when an analysis lands: length, voiced frames, and how far from the written pitch. */
export function summaryOf(s: Pick<RefState, "fileName" | "durationMs" | "frames" | "deviation">): string {
  const voiced = s.frames.reduce((n, f) => (f.midi === null ? n : n + 1), 0);
  const parts = [`${(s.durationMs / 1000).toFixed(1)} s`, `${voiced} voiced of ${s.frames.length} frames`];
  if (s.deviation) parts.push(`within ${Math.round(s.deviation.median * 100)} cents of the written pitch`);
  return `${s.fileName ?? "recording"}: ${parts.join(" · ")}`;
}

export function ReferencePanel({ state, actions }: PanelProps) {
  const s = useStore(state);
  const input = useRef<HTMLInputElement>(null);
  const voiced = s.frames.reduce((n, f) => (f.midi === null ? n : n + 1), 0);
  const W = Math.max(1, Math.round(s.durationMs));
  const { lo, hi } = pitchRange(s.written, s.frames);
  const yOf = (midi: number): number => 92 - ((midi - lo) / Math.max(1, hi - lo)) * 84;

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) actions.load({ name: f.name, arrayBuffer: () => f.arrayBuffer() });
    e.target.value = "";
  };
  // The playhead follows the pointer: press anywhere on the strip and it
  // jumps there, drag and it follows, release and it stays (a playing take
  // jumps with it). The pointer is captured so a drag may leave the strip.
  const seekTo = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    actions.seek(Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * W));
  };
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (s.status !== "ready" || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekTo(e);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (s.status !== "ready" || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seekTo(e);
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const status = (): ReactNode => {
    switch (s.status) {
      case "empty":
        return <span style={DIM}>no recording loaded</span>;
      case "decoding":
        return <span style={DIM}>decoding…</span>;
      case "analysing":
        return <span style={DIM}>detecting pitch… {Math.round(s.progress * 100)}%</span>;
      case "error":
        return <span style={{ color: "#f88" }}>{s.error}</span>;
      case "ready":
        // The summary (length, voiced frames, cents) is a notice when the
        // analysis lands — the user asked not to see it all the time.
        return null;
    }
  };

  const strip = (): ReactNode => {
    if (s.status !== "ready") return <div style={HINT}>{s.status === "empty" ? "Load a recording of this score to trace its pitch over the notes." : status()}</div>;
    const env = s.envelope;
    const envPoints: string[] = [];
    if (env && env.length) {
      const step = W / env.length;
      for (let i = 0; i < env.length; i++) envPoints.push(`${(i * step).toFixed(1)},${(50 - env[i]! * 46).toFixed(1)}`);
      for (let i = env.length - 1; i >= 0; i--) envPoints.push(`${(i * step).toFixed(1)},${(50 + env[i]! * 46).toFixed(1)}`);
    }
    const xOf = (wavMs: number): number => wavMs;
    return (
      <svg data-pitch-ref-strip viewBox={`0 0 ${W} 100`} preserveAspectRatio="none" style={STRIP} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <title>drag to choose where playback starts</title>
        {envPoints.length ? <polygon points={envPoints.join(" ")} fill="#2f3b4b" /> : null}
        {s.measures.map((m) => (
          <line key={m.id} x1={toWavMs(s.alignment, m.fromMs)} x2={toWavMs(s.alignment, m.fromMs)} y1={0} y2={100} stroke="#56657a" vectorEffect="non-scaling-stroke" />
        ))}
        {s.written.map((n, i) => (
          <rect key={`${n.id}-${i}`} x={toWavMs(s.alignment, n.fromMs)} width={Math.max(1, (n.toMs - n.fromMs) / s.alignment.rate)} y={yOf(n.midi) - 1.6} height={3.2} fill="rgba(120,180,255,0.55)" />
        ))}
        <path data-pitch-ref-trace d={tracePath(s.frames, xOf, yOf)} fill="none" stroke="#ffd166" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <line x1={s.alignment.offsetMs} x2={s.alignment.offsetMs} y1={0} y2={100} stroke="#ffd166" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <line data-pitch-ref-playhead x1={s.playheadMs} x2={s.playheadMs} y1={0} y2={100} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    );
  };

  return (
    <div data-pitch-ref data-pitch-ref-state={s.status} data-pitch-ref-frames={s.frames.length} data-pitch-ref-voiced={voiced} data-pitch-ref-offset={Math.round(s.alignment.offsetMs)} data-pitch-ref-rate={s.alignment.rate.toFixed(4)} data-pitch-ref-transpose={s.transpose} data-pitch-ref-deviation={s.deviation ? s.deviation.median.toFixed(3) : ""} data-pitch-ref-playing={s.playing ? "true" : "false"} data-pitch-ref-playing-score={s.playingScore ? "true" : "false"} data-pitch-ref-playhead={Math.round(s.playheadMs)} style={ROOT}>
      <div style={ROW}>
        <strong>🎙 pitch reference</strong>
        <button
          data-pitch-ref-load
          style={BTN}
          onClick={() => {
            actions.unlock();
            input.current?.click();
          }}
        >
          load a recording…
        </button>
        <input ref={input} data-pitch-ref-file type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a" hidden onChange={onFile} />
        {s.fileName ? <span title={s.fileName}>{s.fileName}</span> : null}
        <button data-pitch-ref-play style={BTN} title={s.playing ? "pause the recording" : "play the recording from the white line"} onClick={actions.playPause} disabled={s.status !== "ready"}>
          {s.playing ? "⏸" : "▶"} song
        </button>
        <button data-pitch-ref-play-score style={BTN} title={s.playingScore ? "stop the written notes" : "play the written notes through your MIDI outputs from the white line, at the recording's pace"} onClick={actions.playPauseScore} disabled={s.status !== "ready"}>
          {s.playingScore ? "⏸" : "▶"} score
        </button>
        <span data-pitch-ref-status>{status()}</span>
        <span style={{ flex: 1 }} />
        <label title="where bar 1 begins in the recording (click the strip to set it)">
          <span style={DIM}>bar 1 at </span>
          <input data-pitch-ref-offset-input style={NUM} type="number" step={10} value={Math.round(s.alignment.offsetMs)} onChange={(e) => actions.setOffset(Number(e.target.value) || 0)} disabled={s.status !== "ready"} /> <span style={DIM}>ms</span>
        </label>
        <label title="the tempo the recording was played at; empty means the score's">
          <span style={DIM}>recorded at ♩= </span>
          <input
            data-pitch-ref-tempo-input
            style={NUM}
            type="number"
            min={1}
            placeholder={String(s.scoreTempo)}
            value={s.recordedTempo ?? ""}
            onChange={(e) => {
              const v = Number(e.target.value);
              actions.setRecordedTempo(e.target.value === "" || !(v > 0) ? null : v);
            }}
            disabled={s.status !== "ready"}
          />
        </label>
        <label title="transpose the trace: semitones added to the recording's pitch before it is compared and drawn — a voice an octave below the written part: −12">
          <input data-pitch-ref-transpose-input style={{ ...NUM, width: 48 }} type="number" step={1} min={-48} max={48} value={s.transpose} onChange={(e) => actions.setTranspose(Math.round(Number(e.target.value)) || 0)} disabled={s.status !== "ready"} /> <span style={DIM}>st</span>
        </label>
        <label title="draw the trace over the measures in edit view">
          <input data-pitch-ref-overlays type="checkbox" checked={s.showOverlays} onChange={(e) => actions.setShowOverlays(e.target.checked)} /> <span style={DIM}>on the score</span>
        </label>
        {s.status !== "empty" ? (
          <button data-pitch-ref-clear style={BTN} onClick={actions.clear}>
            clear
          </button>
        ) : null}
        <button data-pitch-ref-close style={BTN} title="close" onClick={actions.close}>
          ×
        </button>
      </div>
      {strip()}
    </div>
  );
}
