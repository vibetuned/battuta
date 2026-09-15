/**
 * The transport row, in the host's `docHeader` slot — the second header
 * row, where the score's own tempo sits, because the speed select
 * multiplies it.
 *
 * Every `data-player-*` / `data-midi-*` hook and every inline style is
 * verbatim from 0.0.3's hard-coded row: the browser scripts address this
 * row by those hooks and the picture must not move. What changed is who
 * owns it.
 *
 * The component SUBSCRIBES (`useStore`) rather than taking props from the
 * outside and being re-mounted when they change: a slot item's `render()`
 * runs on every re-render of the host's slot, and a remount here would
 * restart the progress readout mid-play. Everything it DOES arrives as a
 * callback from `activate` — this file holds no player and no settings.
 */
import { useSyncExternalStore } from "react";
import type { Store, ViewMode } from "@battuta/api";
import { TEMPO_STEPS } from "./manifest";
import type { PlayerState } from "./player";

/** React over a host store — six lines, so the row subscribes IN PLACE. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(
    (onChange) => {
      const d = store.subscribe(onChange);
      return () => d.dispose();
    },
    () => store.get(),
    () => store.get(),
  );
}

/** Everything the row draws, in one object so one subscription serves it. */
export interface Transport {
  state: PlayerState;
  /** Listening seconds elapsed and total, at the current speed. */
  pos: number;
  total: number;
  /** Speed multiplier (× the score tempo). */
  tempo: number;
  /** Send to the MIDI outputs instead of the built-in piano. */
  midiOut: boolean;
  /** Semitones on the MIDI sends and the playback-MIDI export. */
  transpose: number;
}

export interface TransportActions {
  playPause(): void;
  stop(): void;
  setTempo(factor: number): void;
  setMidiOut(on: boolean): void;
  setTranspose(semitones: number): void;
  seek(fraction: number): void;
}

/** mm:ss for the player readout. */
export const fmtTime = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export interface TransportRowProps {
  transport: Store<Transport>;
  /** The host's editor mirror: the row exists in page view only. */
  view: Store<ViewMode>;
  actions: TransportActions;
}

export function TransportRow({ transport, view, actions }: TransportRowProps) {
  const t = useStore(transport);
  // Page view only — the same condition the App's `view === "pages" && …`
  // carried. In tile view the row renders nothing at all, so the second
  // header row has exactly the DOM it had before this plugin existed.
  if (useStore(view) !== "pages") return null;
  return (
    <>
      <button data-player-toggle title={t.state === "playing" ? "pause" : "play (repeats, voltas and one D.S./D.C. jump follow the form)"} onClick={() => actions.playPause()} disabled={t.state === "loading"}>
        {t.state === "playing" ? "⏸" : t.state === "loading" ? "…" : "▶"}
      </button>
      <button data-player-stop title="stop" onClick={() => actions.stop()} disabled={t.state === "idle"}>
        ⏹
      </button>
      <select
        data-player-tempo
        title="playback speed (× the score tempo)"
        value={t.tempo}
        onChange={(e) => {
          const f = Number(e.target.value);
          e.target.blur();
          actions.setTempo(f);
        }}
        style={{ fontSize: 12 }}
      >
        {TEMPO_STEPS.map((f) => (
          <option key={f} value={f}>
            {f}×
          </option>
        ))}
      </select>
      <label data-midi-out title="send playback to every connected MIDI output (each one is a synth's input) instead of the built-in piano" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
        <input type="checkbox" checked={t.midiOut} onChange={(e) => actions.setMidiOut(e.target.checked)} />
        MIDI
      </label>
      <select
        data-midi-transpose
        title="transpose the MIDI sends (and the playback-MIDI export) by this many semitones — the built-in piano is never transposed"
        value={t.transpose}
        onChange={(e) => {
          const semitones = Number(e.target.value);
          e.target.blur();
          actions.setTranspose(semitones);
        }}
        style={{ fontSize: 12 }}
      >
        {Array.from({ length: 25 }, (_, i) => 12 - i).map((semitones) => (
          <option key={semitones} value={semitones}>
            {semitones > 0 ? `+${semitones}` : semitones} st
          </option>
        ))}
      </select>
      {t.state !== "idle" && t.state !== "loading" && (
        <>
          <span
            data-player-progress
            title="seek"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              actions.seek((e.clientX - r.left) / r.width);
            }}
            style={{ width: 140, height: 8, background: "#dde3ea", borderRadius: 4, display: "inline-block", cursor: "pointer", position: "relative", alignSelf: "center", overflow: "hidden" }}
          >
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${t.total ? Math.min(100, (t.pos / t.total) * 100) : 0}%`, background: "#4a7dbd", pointerEvents: "none" }} />
          </span>
          <span data-player-time style={{ fontSize: 12, color: "#567", fontVariantNumeric: "tabular-nums" }}>
            {fmtTime(t.pos)} / {fmtTime(t.total)}
          </span>
        </>
      )}
    </>
  );
}
