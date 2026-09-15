/**
 * The `formats` point — the EXPORT half (slice 7a; imports come with
 * slice 8). A plugin DECLARES an export in its manifest and the host lists
 * it in the battuta menu before the plugin's code has loaded; picking it
 * fires `onFormat:<id>`, the plugin registers the producer, and the host
 * saves what it produces through its one export path (a browser
 * download, or the shell's save dialog). The same lesson as slot items
 * and lanes: an entry point cannot come from the code it loads.
 */
import type { Disposable } from "./disposable.js";

/** An export declared in the manifest (`contributes.exports`). Ids are global, like command ids: `<pluginId>.<name>`. */
export interface ExportContribution {
  id: string;
  /** The menu row reads "export <label> (.<ext>)". */
  label: string;
  /** File extension without the dot; the default file name is `<document>.<ext>`. */
  ext: string;
  /** MIME type of the saved file. */
  mime: string;
  /** Tooltip on the menu row. */
  title?: string;
}

/** What a producer returns: the file's bytes (or text), and its name when the default `<document>.<ext>` is not right. */
export interface ExportPayload {
  bytes: Uint8Array | string;
  filename?: string;
}

export interface FormatsService {
  /**
   * Provide the producer for an export this plugin DECLARED. Disposed with
   * the plugin (or by hand): the menu row stays (it is declared), and
   * picking it wakes the plugin again.
   */
  registerExport(id: string, produce: () => Promise<ExportPayload>): Disposable;
}
