/**
 * What the host knows about this plugin WITHOUT loading its code. The
 * module imports nothing but a type from `@battuta/api`: the host loads it
 * statically (it rides in the `battuta-shared` chunk).
 */
import type { PluginManifest } from "@battuta/api";

/** The panel's id in the host's float area (the `data-panel` hook). */
export const PANEL_ID = "screencast-keys";

export const manifest: PluginManifest = {
  id: "battuta.screencast-keys",
  name: "Screencast keys",
  version: "1.3.0",
  description: "Shows the keys you press, with what they did, and the MIDI notes you play, in the window's bottom-left corner — for video demos and screenshots. Off until you turn it on.",
  // ^1.3.4 carries `ctx.keys`, the float panel side and `enabledByDefault`,
  // added for this plugin (approved by the user on 2026-10-29).
  engines: { battuta: "^1.3.4" },
  // Woken at startup — but only once turned on: it starts off.
  activationEvents: ["onStartup"],
  // The notes come from the MIDI service: every input, the on-screen piano included.
  capabilities: ["midi"],
  enabledByDefault: false,
  // Deliberately NOT declared: no commands, keys or slot items — the
  // Plugins tab turns it on and off, and while on it only shows.
};
