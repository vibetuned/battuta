/**
 * What the host knows about this plugin WITHOUT loading its code.
 *
 * The 📁 is DECLARED here, so the host renders it in the header row before
 * a byte of this plugin is fetched; the click runs the command, which is
 * what activates the plugin. An entry point cannot come from the code it
 * loads — the same lesson as the on-screen keyboard's 🎹 and the lane box.
 *
 * The module imports nothing but a type from `@battuta/api`: the host
 * loads it statically (it rides in the `battuta-shared` chunk), so the
 * plugin's own code must not ride along.
 */
import type { PluginManifest } from "@battuta/api";

/** The one command: show the panel, or hide it if it is already up. */
export const COMMAND_TOGGLE = "battuta.folder-view.toggle";

/** The panel's id in the host's side area (and the `data-panel` hook). */
export const PANEL_ID = "folder-view";

/**
 * `ctx.settings` key: the folder the user opened, as an absolute path.
 * Also the key behind `onSettings:folder`, which is what brings the panel
 * back at startup for someone who left a folder open — the folder is the
 * state worth persisting, and having one is what "in use" means here.
 */
export const SETTING_FOLDER = "folder";

export const manifest: PluginManifest = {
  id: "battuta.folder-view",
  name: "Folder view",
  version: "1.0.0",
  description: "A side panel listing the scores in a folder you opened: click one to open it, see which are already open and which have unsaved changes, and watch the list follow the folder as files are added, changed or removed.",
  // ^0.1.15 is the version that carries what a folder view needs and
  // cannot make itself, all of it from slice 9a: `ctx.workspace`
  // (available, pickFolder, openFolder, readDir, openDocument, watch),
  // `ctx.documents` with `path` and `dirty` on each, and the `workspace`
  // capability being offered at all.
  // ^1.0.0 — the contract as released with battuta 0.1.0 (2026-09-18). The
  // notes above name what of it this plugin needs and the 0.1.x number
  // that first carried it; the range is the release.
  engines: { battuta: "^1.0.0" },
  activationEvents: [
    // The 📁 (a declared slot item, below). The registry fires
    // `onCommand:` implicitly when a declared item is clicked; declaring
    // it documents that the click is a wake-up path, not just a call.
    `onCommand:${COMMAND_TOGGLE}`,
    // "you had a folder open when I last quit": the host fires this at
    // startup when this plugin's OWN `folder` setting is truthy, which is
    // how the panel and its folder come back without `onStartup` costing
    // every user this code at launch.
    "onSettings:folder",
  ],
  // The folders the user picked, read-only and scoped. Offered by every
  // build — `ctx.workspace.available` is what says whether the shell is
  // there, and the panel tells the user so rather than failing.
  capabilities: ["workspace"],
  contributes: {
    commands: [{ id: COMMAND_TOGGLE, title: "Folder view" }],
    slotItems: [
      {
        id: "toggle",
        slot: "header",
        label: "📁",
        title: "folder view — the scores in a folder you opened",
        command: COMMAND_TOGGLE,
        // The button means "the panel is showing", and before this plugin
        // has ever run the panel is definitionally not showing. The live
        // item takes the face over the moment we activate.
        dimUntilActive: true,
      },
    ],
  },
  // Deliberately NOT declared: no keybindings (a new feature earns a key
  // when a user asks for one, and the union keymap snapshot stays
  // byte-identical either way), no `onStartup`, no lanes, no exports, no
  // `onDocument:` (9a left it unfired for want of a consumer, and this
  // panel reads `ctx.documents` instead).
};
