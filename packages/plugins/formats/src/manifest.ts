/**
 * What the host knows about this plugin WITHOUT loading its code — and,
 * because the host must know it before loading anything, the FORMAT TABLE
 * itself lives here.
 *
 * The table is the single source of truth for what battuta reads and
 * writes beyond its native MEI, and `test/convert.test.ts` holds it
 * against the real bundled Verovio: an entry added here without Verovio
 * support — or a Verovio upgrade that drops one — fails that test. Each
 * entry carries its contribution (what the host needs: id, label,
 * extensions, whether the file is bytes) plus the one Verovio detail the
 * converter needs (`from` / `op`), which the manifest below drops before
 * handing the host its declarations.
 *
 * Verovio EXPORTS: MEI (the native save), SVG, MIDI, Humdrum, Plaine &
 * Easie. It has no MusicXML export — MusicXML is import-only. SVG is NOT
 * here: engraving is the host's render service, and its export stays the
 * App's, from the render pool.
 *
 * The host imports this module statically (it rides in the
 * `battuta-shared` chunk by design), so it must stay tiny and import
 * nothing but types from `@battuta/api`. That is also why the table lives
 * here rather than in a `table.ts` the manifest imports — rule 3.
 */
import type { ExportContribution, ImportContribution, PluginManifest } from "@battuta/api";

/** Ids are global, like command ids: `<pluginId>.<format>`. A format that goes both ways (PAE, Humdrum) has ONE id and one activation event. */
const ID = "battuta.formats";

export interface ImportFormat extends ImportContribution {
  /** Verovio's `inputFrom` value — except "mxl", which is zip-loaded rather than parsed. */
  from: "musicxml" | "mxl" | "abc" | "pae" | "humdrum";
}

export const IMPORT_FORMATS: ImportFormat[] = [
  { id: `${ID}.musicxml`, from: "musicxml", label: "MusicXML", exts: ["musicxml", "xml"], roots: ["score-partwise", "score-timewise"] },
  { id: `${ID}.mxl`, from: "mxl", label: "compressed MusicXML", exts: ["mxl"], binary: true },
  { id: `${ID}.abc`, from: "abc", label: "ABC", exts: ["abc"] },
  { id: `${ID}.pae`, from: "pae", label: "Plaine & Easie", exts: ["pae"] },
  { id: `${ID}.humdrum`, from: "humdrum", label: "Humdrum kern", exts: ["krn", "kern"] },
];

export interface ExportFormat extends ExportContribution {
  /** Which toolkit call produces it. */
  op: "midi" | "humdrum" | "pae";
  /** The worker hands this one back as base64 (a standard MIDI file's bytes). */
  binary?: boolean;
}

/** Menu order among this plugin's rows. MEI is not here — that is the regular save. */
export const EXPORT_FORMATS: ExportFormat[] = [
  { id: `${ID}.midi`, op: "midi", label: "MIDI (written score)", ext: "mid", mime: "audio/midi", binary: true },
  { id: `${ID}.humdrum`, op: "humdrum", label: "Humdrum kern", ext: "krn", mime: "text/plain" },
  { id: `${ID}.pae`, op: "pae", label: "Plaine & Easie", ext: "pae", mime: "text/plain" },
];

/**
 * One event per format id — six, not eight: PAE and Humdrum go both ways
 * and share an id, so opening a `.krn` and exporting Humdrum are the same
 * wake-up. Whichever fires, `activate` registers every converter and
 * producer; the host then asks again for the one that woke us.
 */
const FORMAT_IDS = [...new Set([...IMPORT_FORMATS, ...EXPORT_FORMATS].map((f) => f.id))];

export const manifest: PluginManifest = {
  id: ID,
  name: "Format converters",
  version: "0.1.0",
  description: "MusicXML (plain and zipped), ABC, Plaine & Easie and Humdrum convert to MEI on open; MIDI (written score), Humdrum and Plaine & Easie are written back out. Verovio's Humdrum-enabled build, in this plugin's own worker, loaded on the first conversion.",
  // ^0.1.14 is the version that carries both halves of `formats` as a
  // plugin needs them: `contributes.imports` (extensions, text-or-bytes,
  // the root elements that tell a MusicXML `.xml` from an MEI one),
  // `ImportFile`, `ctx.formats.registerImport` and `ExportPayload.files`
  // from 8a — and `ctx.query.mei()`, which 8a's rehearsal did not need
  // because it had the session by closure and this plugin cannot
  // (POSTMORTEM-2026-09-16.md §7.1).
  engines: { battuta: "^0.1.14" },
  // Opening a file of a claimed extension, or picking one of the three
  // export rows. Nothing else: no `onStartup` — a session that only ever
  // touches MEI never fetches the Humdrum build, which is the point of
  // the slice.
  activationEvents: FORMAT_IDS.map((id) => `onFormat:${id}` as const),
  contributes: {
    // The Verovio detail is the converter's business, not the host's.
    imports: IMPORT_FORMATS.map(({ from: _from, ...entry }) => entry),
    exports: EXPORT_FORMATS.map(({ op: _op, binary: _binary, ...entry }) => entry),
  },
  // Deliberately NOT declared: no capabilities (a worker is a plugin's to
  // ship, not a host service to ask for), no commands, no keybindings (an
  // extraction adds no binding — the union keymap snapshot must stay
  // byte-identical), no slot items, no lanes, no panel.
};
