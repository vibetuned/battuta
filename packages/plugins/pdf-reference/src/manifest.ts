/**
 * What the host knows about this plugin WITHOUT loading its code.
 *
 * The 📄 is DECLARED here, so the host renders it in the header row before
 * a byte of this plugin — or of the PDF library behind it — is fetched; the
 * click runs the command, which is what activates the plugin. The module
 * imports nothing but a type from `@battuta/api`: the host loads it
 * statically (it rides in the `battuta-shared` chunk).
 */
import type { PluginManifest } from "@battuta/api";

/** The one command: show the panel and the scans, or hide them. */
export const COMMAND_TOGGLE = "battuta.pdf-reference.toggle";

/** The panel's id in the host's bottom area (and the `data-panel` hook). */
export const PANEL_ID = "pdf-reference";

/** The overlay's id on the host's overlays point: a band, the scan above every tile (`data-band`). */
export const OVERLAY_ID = "scan";

/** The declared export: the systems and measures of the PDF open here — drawn or read — as the OMR pipeline's page files. */
export const EXPORT_ANNOTATIONS = "battuta.pdf-reference.annotations";

export const manifest: PluginManifest = {
  id: "battuta.pdf-reference",
  name: "PDF reference",
  version: "1.2.0",
  description: "Load a score's PDF and its OMR annotation files and see each measure's scan above its tile, and the system it sits in, in a panel that follows the caret — the start of the facsimile.",
  // ^1.2.0 is the version that carries the overlays point's BAND (room above
  // every tile, built against this plugin) and `ctx.query.measureIds()`
  // (matching annotated measures to the score by id).
  engines: { battuta: "^1.2.0" },
  activationEvents: [
    // The 📄 (a declared slot item, below): the one wake-up path. A user who
    // never opens a PDF never fetches the PDF library.
    `onCommand:${COMMAND_TOGGLE}`,
    // "export PDF annotations" from the battuta menu with the plugin cold:
    // the host wakes us, we register the producer, it asks again (and says
    // there is nothing to export until a PDF is open here).
    `onFormat:${EXPORT_ANNOTATIONS}`,
  ],
  contributes: {
    commands: [{ id: COMMAND_TOGGLE, title: "PDF reference" }],
    exports: [
      {
        id: EXPORT_ANNOTATIONS,
        label: "PDF annotations",
        ext: "json",
        mime: "application/json",
        title: "the systems and measures of the PDF open in the PDF reference — drawn or read — one file per page, in the OMR pipeline's format",
      },
    ],
    slotItems: [
      {
        id: "toggle",
        slot: "header",
        label: "📄",
        title: "PDF reference — the score's scan above each measure",
        command: COMMAND_TOGGLE,
        // The button means "the scans are showing", and before this plugin
        // has ever run they are definitionally not.
        dimUntilActive: true,
      },
    ],
  },
  // Deliberately NOT declared: no capabilities (the PDF arrives through a
  // file input and is rasterized here; nothing of the shell is needed), no
  // keybindings, no `onStartup`, no imports (a PDF is a reference, never a
  // document to open as a tab).
};
