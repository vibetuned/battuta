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

/** One exported file: its bytes (or text), and its name when the default `<document>.<ext>` is not right. */
export interface ExportFile {
  bytes: Uint8Array | string;
  filename?: string;
}

/** What a producer returns: one file, or several (an SVG export writes a page per file). */
export type ExportPayload = ExportFile | { files: ExportFile[] };

/**
 * An import declared in the manifest (`contributes.imports`): the file
 * extensions this converter claims. The host widens the open dialog's
 * accept list before the plugin's code loads; opening such a file fires
 * `onFormat:<id>`, the plugin registers the converter, and the MEI it
 * returns opens as a NEW unsaved document (a plain save must never
 * overwrite the source with MEI). Ids are global, like command ids.
 */
export interface ImportContribution {
  id: string;
  /** Shown in the open notice: "imported x.abc (<label> → MEI)". */
  label: string;
  /** Lower-case extensions without the dot. */
  exts: string[];
  /** The file is a container (a zip): hand the converter bytes, not text. */
  binary?: boolean;
  /**
   * For an extension MEI shares (`.xml`): the root element names that mark
   * a file as THIS format rather than MEI. Detection is the host's — a
   * plugin declares roots, never a sniffer.
   */
  roots?: string[];
}

/** What the host hands a converter: the file's name, and its text or — for a `binary` import — its bytes. */
export interface ImportFile {
  name: string;
  text?: string;
  bytes?: ArrayBuffer;
}

export interface FormatsService {
  /**
   * Provide the producer for an export this plugin DECLARED. Disposed with
   * the plugin (or by hand): the menu row stays (it is declared), and
   * picking it wakes the plugin again.
   */
  registerExport(id: string, produce: () => Promise<ExportPayload>): Disposable;
  /**
   * Provide the converter for an import this plugin DECLARED: the file in,
   * MEI text out (throw to refuse — the host shows the message). Disposed
   * with the plugin; the extensions stay accepted (they are declared) and
   * opening one wakes the plugin again.
   */
  registerImport(id: string, convert: (file: ImportFile) => Promise<string>): Disposable;
}
