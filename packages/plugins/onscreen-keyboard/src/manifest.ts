/**
 * What the host knows about this plugin WITHOUT loading its code.
 *
 * The host imports this module statically (it rides in the
 * `battuta-shared` chunk by design), so it must stay tiny and import
 * nothing but a type from `@battuta/api`. The command id lives here as an
 * exported const and `src/index.tsx` imports it, so it is written once.
 *
 * The entry point matters more here than in a command-only plugin: a
 * button that opens this plugin's panel cannot be contributed by the
 * panel's own code, because it would not be there to open it. So the 🎹
 * is DECLARED — `contributes.slotItems` — and the host renders it in the
 * header row before a byte of this plugin is fetched; the click runs the
 * command, which is what activates the plugin (decided 2026-09-14).
 */
import type { PluginManifest } from "@battuta/api";

/**
 * The one command: show the panel, or hide it if it is already up — the
 * 0.0.3 gesture, restored. Two api additions make a real toggle safe here
 * (BUILDING.md §7.2): `ctx.activatedBy` says whether this very click is
 * what woke the plugin, so `activate` knows not to open a panel the
 * handler is about to toggle; and a runtime slot item may replace the
 * declared one's face, so the 🎹 shows its state again.
 */
export const COMMAND_TOGGLE = "battuta.onscreen-keyboard.toggle";

/** The panel's id in the host's bottom panel area (and the `data-panel` hook). */
export const PANEL_ID = "onscreen-keyboard";

/**
 * `ctx.settings` key: is the panel up? Absent means "open on a touch
 * device". Also the key behind `onSettings:open`, which is what brings the
 * panel back at startup for someone who left it up.
 */
export const SETTING_OPEN = "open";

export const manifest: PluginManifest = {
  id: "battuta.onscreen-keyboard",
  name: "On-screen keyboard",
  version: "0.1.0",
  description: "A touch panel that projects the keymap: one button per action, sticky ctrl-free modifier latches, a digit pad, and a two-octave piano that enters notes through the MIDI service.",
  // ^0.1.4 rather than ^0.1.0: this plugin needs `ctx.actions` (0.1.1),
  // manifest-declared slot items (0.1.2), `ctx.activatedBy`,
  // `onSettings:`, the reactive `ctx.actions.ids` and a runtime item
  // overriding a declared one (0.1.3), and `dimUntilActive` (0.1.4).
  // Pinning the range it actually uses is what makes the engine check
  // worth running.
  engines: { battuta: "^0.1.4" },
  activationEvents: [
    // A touch-first device gets the panel without being asked, exactly as
    // 0.0.3 did from `matchMedia("(pointer: coarse)")` — the difference is
    // that the HOST decides, at startup, and a fine-pointer user never
    // loads this code.
    "onPointer:coarse",
    // "you were in use when I last quit": the host fires this at startup
    // when this plugin's OWN `open` setting is truthy, which is how a panel
    // left up comes back on a desktop without `onStartup` costing every
    // user the code at launch.
    "onSettings:open",
    // The 🎹 (a declared slot item, below). The registry fires
    // `onCommand:` implicitly when a declared item is clicked; declaring it
    // documents that the click is a wake-up path, not just a call.
    `onCommand:${COMMAND_TOGGLE}`,
  ],
  // The piano is a virtual MIDI input, so the host's entry path hears it
  // exactly as it hears a hardware controller. That is the only capability
  // this plugin needs: no workspace, no playback.
  capabilities: ["midi"],
  contributes: {
    commands: [{ id: COMMAND_TOGGLE, title: "On-screen keyboard" }],
    // The entry point. `label` is the face the host renders, `title` the
    // tooltip — both copied verbatim from 0.0.3's hard-coded header button.
    slotItems: [
      {
        id: "toggle",
        slot: "header",
        label: "🎹",
        title: "on-screen keyboard — piano + every shortcut, for touch devices",
        command: COMMAND_TOGGLE,
        // The button means "the panel is showing", and before this plugin
        // has ever run the panel is definitionally not showing — so the
        // declared face is drawn grey, exactly as the live one is while the
        // panel is down. The live item takes over the moment we activate.
        dimUntilActive: true,
      },
    ],
  },
  // Deliberately NOT declared: no keybindings (an extraction adds no
  // binding — the union keymap snapshot must stay byte-identical), and no
  // `onStartup` (it would cost every user this code at launch).
};
