/**
 * What the host knows about this plugin WITHOUT loading its code. The
 * module imports nothing but a type from `@battuta/api`: the host loads it
 * statically (it rides in the `battuta-shared` chunk), so the plugin's own
 * code must not ride along.
 */
import type { PluginManifest } from "@battuta/api";

/** The overlay's id on the host's overlays point (the `data-overlay` hook): the cross at the tip. */
export const OVERLAY_ID = "cross";

export const manifest: PluginManifest = {
  id: "battuta.stylus",
  name: "Stylus",
  version: "1.3.0",
  description: "Write notes with the Apple Pencil or the S Pen: touch a staff, drag the cross at the tip to set the length (across) and the pitch (up, down), lift to write. Squeeze, or press the side button, to add to a chord. iPad and Android tablets.",
  // ^1.3.0 carries `ctx.stylus`, the capability and `core.enterNote`; 1.3.1
  // the input's length (`editor.entryDur` / `entryDots`, `setEntryLength`)
  // and `core.enterNote`'s dots; 1.3.2 `core.addChordNote`; 1.3.3 the caret
  // going to what those two wrote — all for this plugin, approved by the
  // user on 2026-10-29.
  engines: { battuta: "^1.3.3" },
  activationEvents: [
    // A tablet: the only devices with a stylus the shell captures. On any
    // other touch device `ctx.stylus.available` is false and the plugin
    // does nothing.
    "onPointer:coarse",
  ],
  capabilities: ["stylus"],
  // Deliberately NOT declared: no commands, keybindings or slot items — the
  // pen is the whole interface, and the score is where it is used.
};
