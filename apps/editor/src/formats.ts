/**
 * Import/export format table — everything battuta can read and write
 * beyond its native MEI, backed by Verovio's converters (the Humdrum-
 * enabled build, loaded lazily in convertWorker only when a conversion
 * is actually requested). Pure data + detection so tests can hold the
 * table against the real toolkit: every import format must load a
 * sample and yield MEI, every export format must produce output
 * (test/convert.test.ts).
 *
 * Verovio EXPORTS: MEI (native save), SVG, MIDI, Humdrum, Plaine &
 * Easie. It has no MusicXML export — MusicXML is import-only.
 *
 * Detection and the open dialog's extension list are the host's
 * (host/formats.ts) since slice 8a: the App registers these entries there
 * as INTERNAL imports and exports, and a plugin declares its own.
 */

export interface ImportFormat {
  /** Verovio inputFrom value (mxl is zip-loaded, not an inputFrom). */
  id: "musicxml" | "mxl" | "abc" | "pae" | "humdrum";
  label: string;
  /** Lower-case filename extensions claiming this format. */
  exts: string[];
  /** Read the file as bytes, not text (zip container). */
  binary?: boolean;
  /** Root elements that claim a shared extension (.xml) for this format rather than MEI — the host's detection reads them. */
  roots?: string[];
}

export const IMPORT_FORMATS: ImportFormat[] = [
  { id: "musicxml", label: "MusicXML", exts: ["musicxml", "xml"], roots: ["score-partwise", "score-timewise"] },
  { id: "mxl", label: "compressed MusicXML", exts: ["mxl"], binary: true },
  { id: "abc", label: "ABC", exts: ["abc"] },
  { id: "pae", label: "Plaine & Easie", exts: ["pae"] },
  { id: "humdrum", label: "Humdrum kern", exts: ["krn", "kern"] },
];

export interface ExportFormat {
  id: "svg" | "midi" | "humdrum" | "pae";
  label: string;
  ext: string;
  mime: string;
  /** The exported payload is binary (base64 from the worker). */
  binary?: boolean;
}

/** Menu order. MEI is not listed — that is the regular save. */
export const EXPORT_FORMATS: ExportFormat[] = [
  { id: "midi", label: "MIDI (written score)", ext: "mid", mime: "audio/midi", binary: true },
  { id: "svg", label: "SVG (pages)", ext: "svg", mime: "image/svg+xml" },
  { id: "humdrum", label: "Humdrum kern", ext: "krn", mime: "text/plain" },
  { id: "pae", label: "Plaine & Easie", ext: "pae", mime: "text/plain" },
];
