/**
 * What the host knows about this plugin WITHOUT loading its code.
 *
 * The 🎙 is DECLARED here, so the host renders it in the header row before
 * a byte of this plugin is fetched; the click runs the command, which is
 * what activates the plugin. The module imports nothing but a type from
 * `@battuta/api`: the host loads it statically (it rides in the
 * `battuta-shared` chunk), so the plugin's own code — the detector, the
 * panel — must not ride along.
 */
import type { PluginManifest } from "@battuta/api";

/** The one command: show the panel (and the traces), or hide them if they are up. */
export const COMMAND_TOGGLE = "battuta.pitch-reference.toggle";

/** The panel's id in the host's bottom area (and the `data-panel` hook). */
export const PANEL_ID = "pitch-reference";

/** The overlay's id on the host's overlays point (the `data-overlay` hook). */
export const OVERLAY_ID = "trace";

/**
 * `ctx.storage` key prefix: `align:<document name>` → `{ offsetMs,
 * recordedTempo }`, the alignment the user settled on for that score. The
 * recording itself is never stored — a wav is megabytes and the file is
 * the user's; the two numbers that took work to find are what is kept.
 */
export const STORAGE_ALIGN = "align:";

/** The tempo the timemap runs at when the score sets none (Verovio's default). */
export const DEFAULT_TEMPO = 120;

export const manifest: PluginManifest = {
  id: "battuta.pitch-reference",
  name: "Pitch reference",
  version: "1.0.0",
  description: "Load a recording of the score and see its pitch traced over every measure and over the whole file, with the written notes on the same axis — where the take is sharp, flat, early or late; play the take, or the written notes through MIDI, from the same playhead.",
  // ^0.1.16 is the version that carries `ctx.overlays` (slice 10a, built
  // against this plugin as its consumer) and the staff context types the
  // pitch axis is read from; `ctx.audio` (7a) decodes the file.
  // ^1.0.0 — the contract as released with battuta 0.1.0 (2026-09-18). The
  // notes above name what of it this plugin needs and the 0.1.x number
  // that first carried it; the range is the release.
  engines: { battuta: "^1.0.0" },
  activationEvents: [
    // The 🎙 (a declared slot item, below). The registry fires
    // `onCommand:` implicitly when a declared item is clicked; declaring
    // it documents that the click is the one wake-up path.
    `onCommand:${COMMAND_TOGGLE}`,
  ],
  // The host's one AudioContext decodes and plays the recording, and the
  // MIDI outputs play the written notes plainly; this plugin brings no
  // instrument of its own.
  capabilities: ["audio", "midi"],
  contributes: {
    commands: [{ id: COMMAND_TOGGLE, title: "Pitch reference" }],
    slotItems: [
      {
        id: "toggle",
        slot: "header",
        label: "🎙",
        title: "pitch reference — a recording's pitch traced over the score",
        command: COMMAND_TOGGLE,
        // The button means "the traces are showing", and before this
        // plugin has ever run they are definitionally not.
        dimUntilActive: true,
      },
    ],
  },
  // Deliberately NOT declared: no keybindings (the union keymap snapshot
  // stays byte-identical), no `onStartup` (a user who never loads a
  // recording never fetches the detector), no `onSettings:` (nothing
  // persisted means "in use" — the recording is not kept), no imports (a
  // wav is not a document and must never become a tab), no exports.
};
