/**
 * Format conversion worker: Verovio's HUMDRUM-ENABLED build (≈4.6MB
 * heavier than the host's render-pool build), so it lives in its own
 * worker that this plugin spawns lazily — only when the user actually
 * imports or exports a non-MEI format — and the editing and engraving
 * paths never pay for it.
 *
 * import: any IMPORT_FORMATS `from` value -> MEI (getMEI, score-based)
 * export: MEI -> midi (base64) | humdrum | pae
 *
 * Nothing here engraves: `renderToSVG` and the layout calls are the
 * host's render service, and this package's `verovio.d.ts` does not even
 * declare them.
 */
import createVerovioModule from "verovio/wasm-hum";
import { VerovioToolkit } from "verovio/esm";

let toolkit: VerovioToolkit | null = null;
const ready = createVerovioModule().then((m: unknown) => {
  toolkit = new VerovioToolkit(m as object);
  postMessage({ type: "ready" });
});

interface ImportMsg {
  type: "import";
  id: number;
  from: string; // Verovio inputFrom, or "mxl" for zipped MusicXML
  text?: string;
  bytes?: ArrayBuffer;
}
interface ExportMsg {
  type: "export";
  id: number;
  to: "midi" | "humdrum" | "pae";
  mei: string;
}

onmessage = async (e: MessageEvent<ImportMsg | ExportMsg>) => {
  const msg = e.data;
  await ready;
  const tk = toolkit!;
  try {
    if (msg.type === "import") {
      let ok: boolean;
      if (msg.from === "mxl") {
        // inputFrom is STICKY on the toolkit and poisons the zip loader
        // (its inner LoadData would parse the extracted MusicXML as the
        // leaked format) — "auto" restores detection. Every operation
        // here sets its own inputFrom for the same reason.
        tk.setOptions({ inputFrom: "auto" });
        ok = tk.loadZipDataBuffer(msg.bytes!);
      } else {
        tk.setOptions({ inputFrom: msg.from });
        ok = tk.loadData(msg.text!);
      }
      if (!ok) throw new Error(`Verovio could not parse the ${msg.from} data`);
      const mei = tk.getMEI({ scoreBased: true });
      if (!mei || !mei.includes("<mei")) throw new Error("conversion produced no MEI");
      postMessage({ type: "done", id: msg.id, result: mei });
      return;
    }
    tk.setOptions({ inputFrom: "mei" });
    if (!tk.loadData(msg.mei)) throw new Error("the document did not load for export");
    const result = msg.to === "midi" ? tk.renderToMIDI() : msg.to === "humdrum" ? tk.getHumdrum() : tk.renderToPAE();
    if (!result) throw new Error(`Verovio produced no ${msg.to} output`);
    postMessage({ type: "done", id: msg.id, result });
  } catch (err) {
    postMessage({ type: "done", id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
};
