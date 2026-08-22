/**
 * The format table must never promise what the bundled Verovio cannot
 * do. Runs the REAL Humdrum-enabled toolkit (the one convertWorker
 * ships) over a tiny sample of every import format and every export
 * format: an entry added to formats.ts without Verovio support — or a
 * Verovio upgrade that drops one — fails here.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — the wasm module ships no types
import createVerovioModule from "verovio/wasm-hum";
import { VerovioToolkit } from "verovio/esm";
import { IMPORT_FORMATS, EXPORT_FORMATS, detectImport, OPEN_EXTENSIONS } from "../src/formats";

/** One four-note C-major sample per text import format. */
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
    it(`${f.id} (.${f.exts[0]})`, () => {
      tk.setOptions({ inputFrom: f.id });
      expect(tk.loadData(SAMPLES[f.id]!), `Verovio rejected the ${f.id} sample`).toBeTruthy();
      const mei = tk.getMEI({ scoreBased: true });
      expect(mei).toContain("<mei");
      expect(mei).toContain("<note"); // the notes survived, not just a shell
      tk.setOptions({ inputFrom: "mei" });
    });
  }

  it("every text import format has a sample here", () => {
    for (const f of IMPORT_FORMATS.filter((f) => !f.binary)) expect(SAMPLES[f.id], `add a ${f.id} sample`).toBeDefined();
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

  it("midi / humdrum / pae / svg", () => {
    mei();
    for (const f of EXPORT_FORMATS) {
      const out = f.id === "midi" ? tk.renderToMIDI() : f.id === "humdrum" ? tk.getHumdrum() : f.id === "pae" ? tk.renderToPAE() : tk.renderToSVG(1);
      expect(out.length, `${f.id} export came back empty`).toBeGreaterThan(0);
    }
    // MIDI is base64 of a standard MIDI file — "MThd" header
    expect(atob(tk.renderToMIDI()).startsWith("MThd")).toBe(true);
  });
});

describe("detection", () => {
  it("maps extensions to formats", () => {
    expect(detectImport("song.mei")).toBe("mei");
    expect(detectImport("song.musicxml")).toBe("musicxml");
    expect(detectImport("song.mxl")).toBe("mxl");
    expect(detectImport("song.abc")).toBe("abc");
    expect(detectImport("song.pae")).toBe("pae");
    expect(detectImport("song.krn")).toBe("humdrum");
    expect(detectImport("song.kern")).toBe("humdrum");
    expect(detectImport("song.pdf")).toBe(null);
  });

  it("sniffs ambiguous .xml by root element", () => {
    expect(detectImport("song.xml", SAMPLES["musicxml"])).toBe("musicxml");
    expect(detectImport("song.xml", `<?xml version="1.0"?><mei xmlns="x"/>`)).toBe("mei");
    expect(detectImport("song.xml")).toBe("mei"); // no content: historical default
  });

  it("the open-dialog extension list covers mei and every import format", () => {
    expect(OPEN_EXTENSIONS).toContain("mei");
    for (const f of IMPORT_FORMATS) for (const e of f.exts) expect(OPEN_EXTENSIONS).toContain(e);
  });
});
