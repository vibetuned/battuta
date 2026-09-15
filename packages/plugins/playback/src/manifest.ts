/**
 * What the host knows about this plugin WITHOUT loading its code.
 *
 * The host imports this module statically (it rides in the
 * `battuta-shared` chunk by design), so it must stay tiny and import
 * nothing but a type from `@battuta/api`. Everything shared between the
 * manifest and `src/index.tsx` — the export id, the settings keys — is an
 * exported const here, so each string is written once.
 *
 * Two entry points, neither of which can come from this plugin's own
 * code: the transport row appears when you open PAGE VIEW (`onView:pages`
 * wakes us, and `activate` adds the row), and the playback-MIDI export is
 * DECLARED, so the battuta menu lists it before a byte of this plugin is
 * fetched and picking it fires `onFormat:<id>`.
 */
import type { PluginManifest } from "@battuta/api";

/** The declared export's id. Global, like a command id: `<pluginId>.<name>`. */
export const EXPORT_MIDI = "battuta.playback.midi";

/** `ctx.settings` keys. All three were root settings until slice 7b moved them (see `apps/editor/src/settings.ts`). */
export const SETTING_TEMPO = "tempo";
export const SETTING_MIDI_OUT = "midiOut";
export const SETTING_TRANSPOSE = "midiTranspose";

/** Playback speed multipliers offered by the row's select (× the score tempo). */
export const TEMPO_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export const manifest: PluginManifest = {
  id: "battuta.playback",
  name: "Playback",
  version: "0.1.0",
  description: "The page-view player: play/pause, stop, speed, MIDI out and transpose, a progress bar that seeks, a sampled piano on the host's AudioContext — and the playback-MIDI export, the same performance written to a file.",
  // ^0.1.11 is the version that carries everything this plugin plays on:
  // `ctx.audio` (unlock/context/timeAt), `ctx.query.timemap()` and
  // `notation()`, `ctx.view.highlight` / `clearHighlight`, the export half
  // of `formats`, and `onView:` actually fired. All of it landed in 7a,
  // built against this plugin as its named consumer.
  engines: { battuta: "^0.1.12" },
  activationEvents: [
    // Page view is where the player lives: entering it is what the row is
    // for, and a user who never opens page view never loads any of this.
    // Not `onStartup`, and not `onPlay` (reserved, unfired — playback has
    // no key, and inventing one would move the union keymap snapshot).
    "onView:pages",
    // Picking "export playback MIDI" from the menu with the plugin cold:
    // the host wakes us, we register the producer, it asks again.
    `onFormat:${EXPORT_MIDI}`,
  ],
  // Both sinks are host services: the AudioContext this plugin connects
  // its own sampler to (it brings Tone.js — the host owns the context,
  // never an instrument), and the MIDI outputs the same performance is
  // sent to when the MIDI box is checked.
  capabilities: ["midi", "audio"],
  contributes: {
    // Listed in the battuta menu before this code exists. Label, ext, mime
    // and title are verbatim from the internal registration 7a rehearsed
    // this with, so the menu row reads exactly as it did in 0.0.3.
    exports: [
      {
        id: EXPORT_MIDI,
        label: "playback MIDI",
        ext: "mid",
        mime: "audio/midi",
        title: "the player's interpretation: repeats, voltas and D.S./D.C. expanded, ties merged, staccato/legato gates applied",
      },
    ],
  },
  // Deliberately NOT declared: no commands and no keybindings (an
  // extraction adds no binding — the union keymap snapshot must stay
  // byte-identical, and playback never had a key), no declared slot item
  // (the row is not an entry point that OPENS something: it IS the
  // feature, and it only exists in page view — the view that wakes us),
  // no panel, no `onStartup`, no `onSettings:` (nothing here should come
  // back on its own at launch; the tempo and MIDI choices are read when
  // the row first renders).
};
