/**
 * What the host knows about this plugin WITHOUT loading its code.
 *
 * The host imports this module statically (it is in the `battuta-shared`
 * chunk by design), so it must stay tiny and import nothing but a type
 * from `@battuta/api` — the plugin's own code must not ride along. The
 * command id lives here as an exported const and `src/index.ts` imports
 * it, so the id is written exactly once.
 */
import type { PluginManifest } from "@battuta/api";

/** The one command. Dotted and prefixed with the plugin id, as the host's validator requires. */
export const COMMAND_CYCLE = "battuta.reflection.cycle";

export const manifest: PluginManifest = {
  id: "battuta.reflection",
  name: "Reflection cycle",
  version: "0.1.0",
  description: "shift+R cycles a block of music through its serial forms: prime → inversion → retrograde → retrograde inversion → prime.",
  engines: { battuta: "^0.1.0" },
  // The key press is the only thing that can ever need this plugin: no
  // view, no format, no document predicate, no startup work. The registry
  // fires onCommand: implicitly when a contributed binding matches, so a
  // user who never presses shift+R never loads a byte of the code.
  activationEvents: [`onCommand:${COMMAND_CYCLE}`],
  contributes: {
    commands: [{ id: COMMAND_CYCLE, title: "Reflection cycle" }],
    keybindings: [
      {
        command: COMMAND_CYCLE,
        // "R" is shift+r. Label, group and context are copied VERBATIM
        // from 0.0.3's core keymap entry, which is what keeps the
        // shortcut editor, the on-screen keyboard and the generated
        // keyboard reference reading exactly as they did before.
        keys: ["R"],
        label: "reflection cycle: inversion → retrograde → retr. inversion → back",
        group: "rhythm",
        when: "block selection",
        // No `layouts` override: R exists on QWERTY and AZERTY alike.
      },
    ],
  },
  // No `capabilities`: it needs no MIDI, no workspace, no playback. A
  // capability it does not use would be a registration failure waiting
  // for a build that does not offer it.
};
