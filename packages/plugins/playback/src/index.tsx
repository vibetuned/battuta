/**
 * Playback, as a plugin.
 *
 * One transport row in the host's `docHeader` slot while page view is up,
 * one scheduler behind it, and one declared export that writes what the
 * scheduler would play. The host hands out an AudioContext (`ctx.audio`),
 * the MIDI outputs (`ctx.midi`), Verovio's timemap and the notation facts
 * (`ctx.query`), and the notation highlight (`ctx.view`). Everything else
 * — the performance (which ties merge, how a staccato shortens a
 * release), the instrument (Tone.js and a sampled piano), the transport
 * and the arrangement of the two sinks — is in this package, so a second
 * player could exist tomorrow without the host having an opinion about
 * any of it.
 *
 * Imports `@battuta/api`, `react`, `tone` and this package's own files,
 * and nothing else. It sends no command message: playback reads the
 * document and never writes to it, so "all plugins off" leaves every
 * score byte-identical by construction rather than by care.
 */
import { definePlugin, toDisposable, type MidiOutputs, type PluginContext, type Store, type ViewMode } from "@battuta/api";
import { EXPORT_MIDI, SETTING_MIDI_OUT, SETTING_TEMPO, SETTING_TRANSPOSE, TEMPO_STEPS } from "./manifest";
import { playbackToMidi } from "./midiExport";
import { buildPerformance } from "./performance";
import { ScorePlayer, type PlayerState } from "./player";
import { TransportRow, type Transport } from "./TransportRow";

/** The row's id in the `docHeader` slot (keyed `<pluginId>:row` by the host). */
export const ROW_ID = "row";

/** How often the progress readout is refreshed while the player is active. */
const POLL_MS = 250;

/** A host-store-shaped holder for the state this plugin owns. */
interface Signal<T> extends Store<T> {
  set(value: T): void;
}

function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const listeners = new Set<(v: T) => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of [...listeners]) l(value);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return toDisposable(() => listeners.delete(listener));
    },
  };
}

/** A speed the select actually offers; anything else (a hand-edited blob) is 1×. */
const readTempo = (raw: unknown): number => (TEMPO_STEPS.includes(raw as (typeof TEMPO_STEPS)[number]) ? (raw as number) : 1);

/** The transpose select's range, as 0.0.3 validated it. */
const readTranspose = (raw: unknown): number => (typeof raw === "number" && Number.isInteger(raw) && Math.abs(raw) <= 24 ? raw : 0);

/** Document identity AND revision in one comparable value; null with nothing open. */
const stamp = (doc: { id: string; version: number } | null): string | null => (doc ? `${doc.id}:${doc.version}` : null);

export default definePlugin({
  activate(ctx: PluginContext) {
    const player = new ScorePlayer(ctx);

    // The three persisted choices, read once. They are this plugin's own
    // settings since 7b; the host carried them out of the root settings
    // blob (the dated migration in apps/editor/src/settings.ts).
    const transport = signal<Transport>({
      state: "idle",
      pos: 0,
      total: 0,
      tempo: readTempo(ctx.settings.get(SETTING_TEMPO)),
      midiOut: ctx.settings.get<boolean>(SETTING_MIDI_OUT) === true,
      transpose: readTranspose(ctx.settings.get(SETTING_TRANSPOSE)),
    });
    const patch = (fields: Partial<Transport>) => transport.set({ ...transport.get(), ...fields });
    player.setTempo(transport.get().tempo);
    player.setMidiTranspose(transport.get().transpose);

    /** Outputs are opened once and KEPT for the session — a re-open per play costs the shell a port round-trip. */
    let sink: MidiOutputs | null = null;
    const releaseSink = () => {
      player.setMidiSink(null);
      sink?.close(); // the shell retracts its virtual source
      sink = null;
    };

    // Progress polling: 4 Hz while the player is active, nothing at all
    // when it is not — the editing path must not pay for a timer.
    let poll: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (poll !== null) clearInterval(poll);
      poll = null;
    };
    player.onStateChange = (state: PlayerState) => {
      if (state === "idle" || state === "loading") {
        stopPolling();
        patch({ state, pos: 0, total: 0 });
        return;
      }
      patch({ state, pos: player.position(), total: player.total() });
      if (poll === null) poll = setInterval(() => patch({ pos: player.position(), total: player.total() }), POLL_MS);
    };

    const playPause = () => {
      const { state, midiOut } = transport.get();
      if (state === "playing") return player.pause();
      if (state === "paused") return player.resume();
      if (state === "loading" || !ctx.document.get()) return;
      void player.unlock(); // inside the gesture, before any await
      // MIDI mode: open the outputs once; if none exist, say so and fall
      // back to the piano rather than playing silence.
      const outputs = midiOut ? (sink ? Promise.resolve(sink) : ctx.midi.openOutputs()) : Promise.resolve(null);
      // The host renders the timemap and reports the notation facts; the
      // PERFORMANCE — ties merged, gates applied, clones mapped — is this
      // plugin's own reading of them (performance.ts).
      Promise.all([outputs, ctx.query.timemap()])
        .then(([opened, timemap]) => {
          if (midiOut && !opened) ctx.notice("no MIDI outputs found — playing through the built-in piano");
          if (midiOut && opened && !sink) {
            sink = opened;
            ctx.notice(`MIDI playback → ${opened.names.join(", ")}`);
          }
          player.setMidiSink(midiOut ? opened : null);
          if (!timemap) return;
          return player.play(buildPerformance(timemap, ctx.query.notation()));
        })
        .catch((e) => ctx.notice(`playback failed: ${e instanceof Error ? e.message : e}`));
    };

    const actions = {
      playPause,
      stop: () => player.stop(),
      setTempo: (factor: number) => {
        patch({ tempo: factor });
        ctx.settings.set(SETTING_TEMPO, factor);
        player.setTempo(factor);
      },
      setMidiOut: (on: boolean) => {
        player.stop(); // the destination changes: reschedule on next play
        releaseSink(); // re-enumerate outputs on the next play
        patch({ midiOut: on });
        ctx.settings.set(SETTING_MIDI_OUT, on);
      },
      setTranspose: (semitones: number) => {
        player.setMidiTranspose(semitones); // live: next attacks use it
        patch({ transpose: semitones });
        ctx.settings.set(SETTING_TRANSPOSE, semitones);
      },
      seek: (fraction: number) => player.seek(fraction),
    };

    // The view, as its own store: the row is page view's, and a caret move
    // must not re-render it. This is also where leaving page view stops
    // the player — the row would vanish with a note still sounding.
    const view = signal<ViewMode>(ctx.editor.get().view);
    ctx.subscriptions.add(
      ctx.editor.subscribe((state) => {
        if (state.view === view.get()) return;
        view.set(state.view);
        if (state.view !== "pages") player.stop();
      }),
    );

    // An edit invalidates the scheduled timemap: every note stamp in the
    // performance came from the document as it was. The host republishes
    // after its render cycle, so this is where an edit is learned — a new
    // tab (a new `id`) counts as a new document.
    let seen = stamp(ctx.document.get());
    ctx.subscriptions.add(
      ctx.document.subscribe((doc) => {
        const now = stamp(doc);
        if (now === seen) return;
        seen = now;
        player.stop(); // a pure no-op when nothing is scheduled
      }),
    );

    ctx.slots.add("docHeader", { id: ROW_ID, render: () => <TransportRow transport={transport} view={view} actions={actions} /> });

    // battuta's playback as MIDI — the SOLVED form the player performs
    // (repeats/voltas/jump expanded, ties merged, articulation gates), not
    // Verovio's written-score MIDI. Declared in the manifest, so the menu
    // row is there with or without this code loaded, and with or without a
    // document.
    ctx.formats.registerExport(EXPORT_MIDI, async () => {
      const timemap = await ctx.query.timemap();
      if (!timemap) throw new Error("no document is open");
      if (timemap.events.length === 0) throw new Error("nothing to play");
      // `<name>-playback.mid`, as 0.0.3 saved it: the written-score MIDI
      // export is `<name>.mid`, and the two are different files.
      // (`DocumentInfo.name` landed on the api for exactly this — BUILDING.md §7.2.)
      const name = ctx.document.get()?.name || "score";
      return { bytes: playbackToMidi(buildPerformance(timemap, ctx.query.notation()), { transpose: transport.get().transpose }), filename: `${name}-playback.mid` };
    });

    // No `deactivate()`: everything this plugin owns is a disposable the
    // host already tracks, and it disposes them in reverse order — so the
    // timer, the ports and the instrument (added last, released first) go
    // before the row that drove them. "Off" is then complete by
    // construction rather than by remembering to write it twice.
    ctx.subscriptions.add(
      toDisposable(() => {
        stopPolling();
        releaseSink();
        player.dispose(); // stops, clears the highlight, drops the sampler
      }),
    );
  },
});
