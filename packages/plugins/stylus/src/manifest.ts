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
  description: "Write notes with the Apple Pencil or the S Pen: touch a staff and a cross at the tip shows the note — the pitch under the pen, the input's length; drag right for longer, left for shorter, up and down for the pitch, and lift to write it (a tap writes it as it is). A length you drag to becomes the input's. On the iPad and Android tablets.",
  // ^1.3.0 carries `ctx.stylus`, the capability and `core.enterNote`; 1.3.1
  // the input's length (`editor.entryDur` / `entryDots`, `setEntryLength`)
  // and `core.enterNote`'s dots — all added for this plugin, approved by the
  // user on 2026-10-29.
  engines: { battuta: "^1.3.1" },
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
