/**
 * The format table must never promise what the bundled Verovio cannot
 * do. Runs the REAL Humdrum-enabled toolkit (the one convertWorker
 * ships) over a tiny sample of every import format and every export
 * format: an entry added to the table without Verovio support — or a
 * Verovio upgrade that drops one — fails here.
 *
 * Moved from `apps/editor/test/` with the converters in slice 8b; the
 * assertions are unchanged. The table lives in `src/manifest.ts` now (the
 * manifest must declare the formats and may import nothing but the api),
 * and each entry names its Verovio call as `from` / `op` because its `id`
 * is the global contribution id. SVG left the table entirely: engraving
 * is the host's render service, not a conversion.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — the wasm module ships no types
import createVerovioModule from "verovio/wasm-hum";
import { VerovioToolkit } from "verovio/esm";
import { EXPORT_FORMATS, IMPORT_FORMATS } from "../src/manifest";

/** One four-note C-major sample per text import format, keyed by its Verovio `from`. */
const SAMPLES: Record<string, string> = {
  musicxml: `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
  </measure></part>
</score-partwise>`,
  abc: `X:1\nT:sample\nM:4/4\nL:1/4\nK:C\nCDEF|\n`,
  pae: `@clef:G-2\n@timesig:4/4\n@data:4'CDEF\n`,
  humdrum: `**kern\n*clefG2\n*M4/4\n4c\n4d\n4e\n4f\n*-\n`,
};

let tk: VerovioToolkit;
beforeAll(async () => {
  tk = new VerovioToolkit(await createVerovioModule());
}, 60000);

describe("every import format converts to MEI with the bundled Verovio", () => {
  for (const f of IMPORT_FORMATS.filter((f) => !f.binary)) {
    it(`${f.from} (.${f.exts[0]})`, () => {
      tk.setOptions({ inputFrom: f.from });
      expect(tk.loadData(SAMPLES[f.from]!), `Verovio rejected the ${f.from} sample`).toBeTruthy();
      const mei = tk.getMEI({ scoreBased: true });
      expect(mei).toContain("<mei");
      expect(mei).toContain("<note"); // the notes survived, not just a shell
      tk.setOptions({ inputFrom: "mei" });
    });
  }

  it("every text import format has a sample here", () => {
    for (const f of IMPORT_FORMATS.filter((f) => !f.binary)) expect(SAMPLES[f.from], `add a ${f.from} sample`).toBeDefined();
  });

  it("mxl (zip) imports EVEN AFTER a leaked inputFrom (the worker's sequence)", () => {
    const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/sample.mxl"));
    const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    // Worst case: a previous text import left inputFrom on the toolkit.
    // The zip loader's inner LoadData would honor it and fail — the
    // worker must restore "auto" first (this pins that fix).
    tk.setOptions({ inputFrom: "mei" });
    tk.setOptions({ inputFrom: "auto" });
    expect(tk.loadZipDataBuffer(bytes)).toBeTruthy();
    const mei = tk.getMEI({ scoreBased: true });
    expect(mei).toContain('pname="g"');
    expect(mei).toContain('pname="b"');
    tk.setOptions({ inputFrom: "mei" });
  });
});

describe("every export format produces output with the bundled Verovio", () => {
  const mei = () => {
    tk.setOptions({ inputFrom: "musicxml" });
    expect(tk.loadData(SAMPLES["musicxml"]!)).toBeTruthy();
    const m = tk.getMEI({ scoreBased: true });
    tk.setOptions({ inputFrom: "mei" });
    expect(tk.loadData(m)).toBeTruthy();
    return m;
  };

  it("midi / humdrum / pae", () => {
    mei();
    for (const f of EXPORT_FORMATS) {
      const out = f.op === "midi" ? tk.renderToMIDI() : f.op === "humdrum" ? tk.getHumdrum() : tk.renderToPAE();
      expect(out.length, `${f.op} export came back empty`).toBeGreaterThan(0);
    }
    // MIDI is base64 of a standard MIDI file — "MThd" header
    expect(atob(tk.renderToMIDI()).startsWith("MThd")).toBe(true);
  });
});
