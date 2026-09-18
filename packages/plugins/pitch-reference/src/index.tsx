/**
 * The pitch reference, as a plugin — the first reference layer, and the
 * first consumer of the host's overlays point.
 *
 * Load a recording of the score: the host's AudioContext decodes it, YIN
 * (here, hand-rolled) detects its pitch, and the trace is drawn twice —
 * over the whole file in a bottom panel, and over every measure tile in
 * edit view — with the written pitch on the same axis, so where the take
 * is sharp, flat, early or late is visible at the note. Two numbers align
 * the two clocks, an offset and a rate; the score's tempo is taken from
 * the timemap and never estimated from the audio.
 *
 * Everything it can do is `ctx`: the audio context, the timemap and the
 * document, a panel, an overlay, a header button, a storage namespace for
 * the alignment. It writes nothing to the document and keeps no audio
 * beyond the session. Imports `@battuta/api`, `react` and this package's
 * own files, and nothing else.
 */
import { definePlugin, toDisposable, type ActivationEvent, type Disposable, type DocumentInfo, type MidiOutputs, type PluginContext, type Store } from "@battuta/api";
import { COMMAND_TOGGLE, DEFAULT_TEMPO, OVERLAY_ID, PANEL_ID, STORAGE_ALIGN } from "./manifest";
import { decodeForAnalysis, envelope } from "./audio";
import { deviation, detectOffsetMs, measureWindows, rateOf, toWavMs, writtenNotes, type Alignment } from "./align";
import { MeasureOverlay } from "./MeasureOverlay";
import { ReferencePanel, summaryOf, type PanelActions, type RefState, type TakeFile } from "./Panel";
import { TakePlayer } from "./player";
import { ScorePlayer } from "./scorePlayer";
import { signal, useStore } from "./store";
import { analysePitch, medianFilter, DEFAULT_YIN, type PitchFrame } from "./yin";

/** What is kept per document: the two numbers that took work to find. */
interface StoredAlignment {
  offsetMs: number;
  recordedTempo: number | null;
  /** Semitones added to the trace; absent in what 0.1.0's first days stored. */
  transpose?: number;
}

/** The trace shifted by `semitones`; the same array when there is nothing to shift. */
const shifted = (raw: readonly PitchFrame[], semitones: number): readonly PitchFrame[] => (semitones === 0 ? raw : raw.map((f) => (f.midi === null ? f : { ...f, midi: f.midi + semitones })));

const EMPTY: RefState = {
  status: "empty",
  fileName: null,
  durationMs: 0,
  progress: 0,
  error: null,
  envelope: null,
  raw: [],
  frames: [],
  transpose: 0,
  alignment: { offsetMs: 0, rate: 1 },
  recordedTempo: null,
  scoreTempo: DEFAULT_TEMPO,
  showOverlays: true,
  buffer: null,
  playing: false,
  playingScore: false,
  playheadMs: 0,
  onsets: {},
  written: [],
  measures: [],
  deviation: null,
};

/** How often the playhead is redrawn while the recording plays. */
const POLL_MS = 50;

/** One comparable value for a caret, so the playhead follows a MOVE and not every editor republish. */
const caretKey = (c: { measureIndex: number; staffN: number; layerN: number; eventIndex: number } | null): string | null => (c ? `${c.measureIndex}/${c.staffN}/${c.layerN}/${c.eventIndex}` : null);

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Document identity AND revision in one comparable value; null with nothing open. */
const stamp = (doc: DocumentInfo | null): string | null => (doc ? `${doc.id}:${doc.version}` : null);

/** The 🎙 once the plugin is active: dims while the panel is down. The declared face comes back on deactivate. */
function ToggleButton({ open, onToggle }: { open: Store<boolean>; onToggle: () => void }) {
  const isOpen = useStore(open);
  return (
    <button data-pitch-ref-toggle title="pitch reference — a recording's pitch traced over the score" onClick={onToggle} style={{ opacity: isOpen ? 1 : 0.45 }}>
      🎙
    </button>
  );
}

const WOKEN_BY_THE_BUTTON: ActivationEvent = `onCommand:${COMMAND_TOGGLE}`;

export default definePlugin({
  activate(ctx: PluginContext) {
    const state = signal<RefState>(EMPTY);
    const open = signal(false);
    const patch = (fields: Partial<RefState>) => state.set({ ...state.get(), ...fields });
    const player = new TakePlayer(ctx.audio);
    const score = new ScorePlayer();
    /** The MIDI outputs, opened once on the first "▶ score" and kept for the activation (a re-open per play costs the shell a port round-trip). */
    let sink: MidiOutputs | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    /** The playhead's clock: the recording when it plays, else the score player. */
    const position = (): number => (player.playing ? player.position() : score.playing ? score.position() : state.get().playheadMs);
    /** Poll the playhead while either transport runs, and not at all otherwise. */
    const syncPolling = () => {
      const on = state.get().playing || state.get().playingScore;
      if (on && poll === null) poll = setInterval(() => patch({ playheadMs: position() }), POLL_MS);
      if (!on && poll !== null) {
        clearInterval(poll);
        poll = null;
      }
    };
    const pause = () => {
      const pos = player.pause();
      if (state.get().playing) patch({ playing: false, playheadMs: pos });
      syncPolling();
    };
    const pauseScore = () => {
      const pos = score.pause();
      if (state.get().playingScore) patch({ playingScore: false, ...(state.get().playing ? {} : { playheadMs: pos }) });
      syncPolling();
    };
    player.onEnded = () => {
      patch({ playing: false, playheadMs: player.position() });
      syncPolling();
    };
    score.onEnded = () => {
      patch({ playingScore: false, ...(state.get().playing ? {} : { playheadMs: score.position() }) });
      syncPolling();
    };
    const clampMs = (ms: number): number => Math.max(0, Math.min(state.get().durationMs, ms));
    let panel: Disposable | null = null;
    let overlay: Disposable | null = null;
    /** The analysis generation: a load or a clear that starts while one runs makes the older run's results fall on the floor. */
    let run = 0;

    const docName = (): string | null => ctx.document.get()?.name ?? null;
    const scoreTempo = (): number => ctx.document.get()?.tempo ?? DEFAULT_TEMPO;
    const alignKey = (name: string): string => `${STORAGE_ALIGN}${name}`;

    const persistAlignment = (): void => {
      const name = docName();
      if (!name) return;
      const s = state.get();
      const stored: StoredAlignment = { offsetMs: s.alignment.offsetMs, recordedTempo: s.recordedTempo, transpose: s.transpose };
      ctx.storage.set(alignKey(name), stored);
    };
    const storedAlignment = (): StoredAlignment | null => {
      const name = docName();
      const v = name ? ctx.storage.get<Partial<StoredAlignment>>(alignKey(name)) : undefined;
      if (!v || typeof v.offsetMs !== "number") return null;
      return { offsetMs: v.offsetMs, recordedTempo: typeof v.recordedTempo === "number" && v.recordedTempo > 0 ? v.recordedTempo : null, transpose: typeof v.transpose === "number" && Number.isFinite(v.transpose) ? Math.round(v.transpose) : 0 };
    };

    /** The rate from the tempos, and the deviation of the trace through the alignment — after anything that moves either. */
    const recompute = (): void => {
      const s = state.get();
      const alignment: Alignment = { offsetMs: s.alignment.offsetMs, rate: rateOf(s.recordedTempo, s.scoreTempo) };
      patch({ alignment, deviation: s.frames.length ? deviation(s.frames, s.written, alignment) : null });
    };

    /** What the score says was written, from the timemap; empty without a document or on a render error. */
    const refreshScore = async (): Promise<void> => {
      const tm = await ctx.query.timemap().catch(() => null);
      const onsets: Record<string, number> = {};
      if (tm) for (const e of tm.events) for (const id of e.on ?? []) if (!(id in onsets)) onsets[id] = e.tstamp;
      patch({ written: tm ? writtenNotes(tm) : [], measures: tm ? measureWindows(tm) : [], onsets, scoreTempo: scoreTempo() });
      recompute();
    };

    const load = async (file: TakeFile): Promise<void> => {
      const gen = ++run;
      pause();
      pauseScore();
      player.load(null);
      patch({ status: "decoding", fileName: file.name, error: null, raw: [], frames: [], envelope: null, deviation: null, progress: 0, durationMs: 0, buffer: null, playheadMs: 0 });
      try {
        // The context is created on the first unlock — normally the click
        // that opened the file dialog (the button calls `unlock` first). A
        // file that arrives another way (dropped, a test) gets one here:
        // outside a gesture the context stays suspended, and decoding does
        // not need it running.
        await ctx.audio.unlock();
        const context = ctx.audio.context();
        if (!context) throw new Error("audio is not available here — the recording cannot be decoded");
        const bytes = await file.arrayBuffer();
        const take = await decodeForAnalysis(context, bytes);
        if (gen !== run) return;
        player.load(take.buffer);
        patch({ status: "analysing", durationMs: take.durationMs, envelope: envelope(take.samples, 600), buffer: take.buffer });
        const raw = await analysePitch(take.samples, DEFAULT_YIN, {
          yield: () => new Promise((r) => setTimeout(r, 0)),
          progress: (done, total) => {
            if (gen === run) patch({ progress: done / total });
          },
        });
        if (gen !== run) return;
        const frames = medianFilter(raw, 5);
        await refreshScore();
        if (gen !== run) return;
        const stored = storedAlignment();
        const transpose = stored?.transpose ?? 0;
        const offsetMs = stored?.offsetMs ?? detectOffsetMs(frames);
        // the playhead starts where bar 1 begins
        patch({ status: "ready", raw: frames, frames: shifted(frames, transpose), transpose, progress: 1, alignment: { offsetMs, rate: 1 }, recordedTempo: stored?.recordedTempo ?? null, playheadMs: offsetMs });
        recompute();
        ctx.notice(summaryOf(state.get())); // the host's toast: seen once, not all the time
      } catch (e) {
        if (gen === run) patch({ status: "error", error: message(e), raw: [], frames: [], envelope: null });
      }
    };

    const actions: PanelActions = {
      unlock: () => void ctx.audio.unlock(),
      load: (file) => void load(file),
      clear: () => {
        run++;
        pause();
        pauseScore();
        player.load(null);
        const s = state.get();
        state.set({ ...EMPTY, showOverlays: s.showOverlays, written: s.written, measures: s.measures, onsets: s.onsets, scoreTempo: s.scoreTempo });
      },
      playPause: () => {
        if (state.get().playing) return pause();
        const from = state.get().playheadMs;
        void player.play(from).then((ok) => {
          if (!ok) return ctx.notice("audio is not available here — the recording cannot be played");
          patch({ playing: true });
          syncPolling();
        });
      },
      playPauseScore: () => {
        if (state.get().playingScore) return pauseScore();
        const from = state.get().playheadMs;
        (sink ? Promise.resolve(sink) : ctx.midi.openOutputs())
          .then((opened) => {
            if (!opened) return ctx.notice("no MIDI outputs found — nothing to play the written notes through");
            if (!sink) {
              sink = opened;
              ctx.notice(`written notes → ${opened.names.join(", ")}`);
            }
            const s = state.get();
            score.play(sink, s.written, s.alignment, from, -s.transpose);
            patch({ playingScore: true });
            syncPolling();
          })
          .catch((e) => ctx.notice(`could not play the written notes: ${message(e)}`));
      },
      seek: (ms) => {
        const t = clampMs(ms);
        patch({ playheadMs: t });
        if (state.get().playing) void player.play(t);
        if (state.get().playingScore && sink) score.play(sink, state.get().written, state.get().alignment, t, -state.get().transpose);
      },
      setOffset: (ms) => {
        patch({ alignment: { ...state.get().alignment, offsetMs: Math.max(0, ms) } });
        recompute();
        persistAlignment();
      },
      setRecordedTempo: (bpm) => {
        patch({ recordedTempo: bpm !== null && bpm > 0 ? bpm : null });
        recompute();
        persistAlignment();
      },
      setTranspose: (semitones) => {
        const t = Math.max(-48, Math.min(48, Math.round(semitones) || 0));
        patch({ transpose: t, frames: shifted(state.get().raw, t) });
        recompute();
        persistAlignment();
        // a playing score moves register with it, from where it is
        if (state.get().playingScore && sink) score.play(sink, state.get().written, state.get().alignment, score.position(), -t);
      },
      setShowOverlays: (on) => patch({ showOverlays: on }),
      close: () => setOpen(false),
    };

    const mount = (): void => {
      if (panel) return;
      panel = ctx.panels.open({ id: PANEL_ID, side: "bottom", title: "pitch reference", render: () => <ReferencePanel state={state} actions={actions} /> });
      overlay = ctx.overlays.add({ id: OVERLAY_ID, render: (tile) => <MeasureOverlay tile={tile} state={state} /> });
      open.set(true);
      void refreshScore();
    };
    const setOpen = (next: boolean): void => {
      if (next) return mount();
      pause(); // no panel, no transport: a closed panel does not keep playing
      pauseScore();
      panel?.dispose();
      panel = null;
      overlay?.dispose();
      overlay = null;
      open.set(false);
    };

    // The score behind the trace: a re-read when the document changes
    // (an edit, another tab) while the panel is up; another document also
    // brings its own remembered alignment.
    let seen = stamp(ctx.document.get());
    let seenId = ctx.document.get()?.id ?? null;
    ctx.subscriptions.add(
      ctx.document.subscribe((doc) => {
        const next = stamp(doc);
        if (next === seen) return;
        seen = next;
        const id = doc?.id ?? null;
        if (id !== seenId) {
          seenId = id;
          const stored = storedAlignment();
          if (stored) {
            const t = stored.transpose ?? 0;
            patch({ alignment: { ...state.get().alignment, offsetMs: stored.offsetMs }, recordedTempo: stored.recordedTempo, transpose: t, frames: shifted(state.get().raw, t) });
          }
        }
        if (open.get()) void refreshScore();
      }),
    );

    // The playhead follows the caret: a MOVE of the caret (not every editor
    // republish) puts the white line at that event's moment in the
    // recording, through the alignment — click a note, press play, hear
    // the take from there. Not while playing, and not without a take.
    let lastCaret = caretKey(ctx.editor.get().caret);
    ctx.subscriptions.add(
      ctx.editor.subscribe((e) => {
        const key = caretKey(e.caret);
        if (key === lastCaret) return;
        lastCaret = key;
        const s = state.get();
        if (!e.caret || s.playing || s.playingScore || s.status !== "ready") return;
        const id = ctx.query.eventIdAt(e.caret);
        const onset = id === null ? undefined : s.onsets[id];
        if (onset === undefined) return;
        patch({ playheadMs: clampMs(toWavMs(s.alignment, onset)) });
      }),
    );

    // The 🎙 becomes live, so it dims while the panel is down.
    ctx.slots.add("header", { id: "toggle", render: () => <ToggleButton open={open} onToggle={() => setOpen(panel === null)} /> });

    // Open now unless the click that woke us is about to toggle the panel
    // itself (activation runs BEFORE the handler it caused).
    if (ctx.activatedBy !== WOKEN_BY_THE_BUTTON) mount();
    ctx.registerCommand(COMMAND_TOGGLE, () => setOpen(panel === null));

    // A running analysis, a playing take and the opened MIDI outputs are
    // the things not handed out by the host, so they are the things to
    // stop: the generation bump drops the analysis, the pauses silence
    // both transports, close() gives the ports back (the shell retracts
    // its virtual source).
    ctx.subscriptions.add(
      toDisposable(() => {
        run++;
        pause();
        pauseScore();
        player.load(null);
        sink?.close();
        sink = null;
      }),
    );
  },
});
