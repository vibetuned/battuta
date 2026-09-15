/**
 * Format converters, as a plugin.
 *
 * Five imports (MusicXML plain and zipped, ABC, Plaine & Easie, Humdrum)
 * and three exports (MIDI of the written score, Humdrum, Plaine & Easie),
 * all of them Verovio's Humdrum-enabled build talking to itself inside
 * this package's own worker. The host owns the doors: it decides from a
 * file's name and root element WHICH import claims it (`formats.detect`,
 * from the extensions and roots the manifest declares), reads the file
 * the way the manifest asked, opens the MEI that comes back as a new
 * unsaved document, lists the export rows and saves what a producer
 * returns. This plugin owns the conversion and nothing else.
 *
 * `activate` registers all eight at once, whichever format woke us: they
 * share one worker, so the first conversion pays for the toolkit and
 * every one after it is instant, and there is nothing to gain from
 * registering them one at a time.
 *
 * Imports `@battuta/api`, Verovio's CONVERTER build and this package's
 * own files, and nothing else. It sends no command message: an import
 * returns MEI text and the HOST opens it, which is what keeps a converted
 * file a new unsaved document rather than an edit to the one on screen.
 */
import { definePlugin, toDisposable, type PluginContext } from "@battuta/api";
import { converter } from "./converter";
import { EXPORT_FORMATS, IMPORT_FORMATS } from "./manifest";

/** base64 (what Verovio hands back for MIDI) to the bytes of a real file. */
const bytesOf = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

export default definePlugin({
  activate(ctx: PluginContext) {
    for (const format of IMPORT_FORMATS) {
      // The host has already decided this file is ours and read it the way
      // the manifest asked (bytes for a zip, text otherwise); all that is
      // left is the conversion, and the MEI it must produce.
      ctx.formats.registerImport(format.id, (file) => converter.toMEI(format.from, file.bytes ?? file.text ?? ""));
    }

    for (const format of EXPORT_FORMATS) {
      ctx.formats.registerExport(format.id, async () => {
        // The score-based serialisation the pages are engraved from, so an
        // export can never disagree with what is on screen. `ctx.query.mei`
        // exists because THIS is what an export producer needs and the
        // first attempt at this slice had no way to ask for it.
        const mei = ctx.query.mei();
        if (mei === null) throw new Error("no document is open");
        const out = await converter.fromMEI(format.op, mei);
        return { bytes: format.binary ? bytesOf(out) : out };
      });
    }

    // Off must hand back the ≈12MB the toolkit holds. No `deactivate()`:
    // the registrations are disposables the host already tracks, and this
    // is one more, disposed after them — so nothing is still converting
    // when the worker goes. Turning the plugin back on spawns a fresh one
    // on the next conversion.
    ctx.subscriptions.add(toDisposable(() => converter.dispose()));
  },
});
