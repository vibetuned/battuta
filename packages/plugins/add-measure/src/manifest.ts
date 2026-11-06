/**
 * What the host knows about this plugin WITHOUT loading its code. The
 * module imports nothing but a type from `@battuta/api`: the host loads it
 * statically (it rides in the `battuta-shared` chunk).
 */
import type { PluginManifest } from "@battuta/api";

/** The overlay's id: the tile after the last measure. */
export const OVERLAY_ID = "plus";

export const manifest: PluginManifest = {
  id: "battuta.add-measure",
  name: "Add measure",
  version: "1.0.0",
  description: "A gray measure with a + after the last one, in edit view: tap it to add a measure — no keyboard needed, for writing with the stylus.",
  // ^1.3.12 carries the overlays point's `end` tile and `core.appendMeasure`,
  // added for this plugin (the user, 2026-11-05).
  engines: { battuta: "^1.3.12" },
  // Woken at startup: the + is there as soon as a score is open.
  activationEvents: ["onStartup"],
  // Deliberately NOT declared: no commands, keys or slot items — the tile
  // after the last measure is its whole interface.
};
