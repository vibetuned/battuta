/**
 * The plugin against a REAL host (`createHost`, memory settings and
 * storage) and a fake session whose measures carry ids; the PDF renderer is
 * mocked (pdf.js needs a browser — the e2e runs the real one). What is left
 * here is the lifecycle a panel-and-band plugin can get wrong: what shows
 * before any code loads, the toggle, a load matched by id and in order,
 * the band's heights and cells, the caret moving the strip, stepping
 * through systems, the checkbox, clear, a load without its PDF, and off.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BandCell, PluginEntry } from "@battuta/api";
import { createHost, memorySettings, type Host, type SessionAdapter } from "../../../../apps/editor/src/host";
import { memoryStorage } from "../../../../apps/editor/src/host/services";
import { manifest, COMMAND_TOGGLE, EXPORT_ANNOTATIONS, OVERLAY_ID, PANEL_ID } from "../src/manifest";
import type { PdfActions, PdfState, PickedFile } from "../src/Panel";

const rendered = vi.hoisted(() => ({ released: [] as string[] }));
const support = vi.hoisted(() => ({ missing: [] as string[] }));
vi.mock("../src/pdf", () => ({
  RENDER_SCALE: 254 / 72,
  // what the system lacks for pdf.js: nothing, unless a test says otherwise
  pdfMissing: () => support.missing,
  PDF_NEEDS: "Reading a PDF needs iOS / iPadOS 26.2 or later",
  renderPdf: vi.fn(async (_bytes: ArrayBuffer, hooks: { progress?: (d: number, t: number) => void } = {}) => {
    hooks.progress?.(0, 2);
    hooks.progress?.(2, 2);
    return [1, 2].map((page) => ({ page, url: `blob:fake/${page}`, width: 2100, height: 2970 }));
  }),
  releasePages: vi.fn((pages: { url: string }[]) => rendered.released.push(...pages.map((p) => p.url))),
}));
vi.mock("../src/images", async (original) => ({
  ...(await original<typeof import("../src/images")>()),
  // the platform's image decoding needs a browser — the e2e decodes real images
  loadImages: vi.fn(async (files: { name: string }[]) => {
    const { orderImages } = await original<typeof import("../src/images")>();
    return orderImages(files).map((f, i) => ({ page: i + 1, url: `blob:img/${f.name}`, width: 2100, height: 2970 }));
  }),
}));
const plugin = (await import("../src/index")).default;

const PLUGIN_ID = manifest.id;
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Two pages: page 1 has two systems (a, b | c), page 2 one (d). */
const pageJson = (n: number) =>
  JSON.stringify({
    width: 2100,
    height: 2970,
    annotations:
      n === 1
        ? [
            { class: "system", bbox: [40, 100, 2050, 400] },
            { class: "system", bbox: [40, 600, 2050, 900] },
            { class: "measure", id: "a", bbox: [200, 100, 1000, 400] },
            { class: "measure", id: "b", bbox: [1000, 100, 2050, 400] },
            { class: "measure", id: "c", bbox: [200, 600, 2050, 900] },
          ]
        : [
            { class: "system", bbox: [40, 100, 2050, 400] },
            { class: "measure", id: "d", bbox: [200, 100, 1200, 400] },
          ],
  });
const file = (name: string, text = ""): PickedFile => ({ name, arrayBuffer: async () => new ArrayBuffer(8), text: async () => text });
const ALL = [file("piece.pdf"), file("piece_page1.json", pageJson(1)), file("piece_page2.json", pageJson(2))];

interface Fixture {
  host: Host;
  loads(): number;
  state(): PdfState;
  actions(): PdfActions;
  panelIds(): string[];
  band(): { height(c: BandCell): number; render(c: BandCell & { height: number }): unknown } | null;
  setIds(ids: (string | null)[]): void;
  publish(version: number): void;
  caret(measureIndex: number): void;
  executed(): unknown[];
}

function fixture(opts: { storage?: ReturnType<typeof memoryStorage> } = {}): Fixture {
  let loads = 0;
  let ids: (string | null)[] = ["a", "b", "c", "d"];
  const executed: unknown[] = [];
  const entry: PluginEntry = {
    manifest,
    load: async () => {
      loads++;
      return { default: plugin };
    },
  };
  const host = createHost({ layout: "qwerty", plugins: [entry], settings: memorySettings(), storage: opts.storage ?? memoryStorage(), confirm: async () => true });
  const adapter: SessionAdapter = {
    execute: (cmd) => executed.push(cmd),
    pitchEventsIn: () => [],
    blockOf: () => null,
    lyricAt: () => null,
    harmAt: () => "",
    timemap: async () => ({ events: [], notes: {}, idMap: {} }),
    notation: () => ({ ties: {}, marks: {} }),
    eventIdAt: () => null,
    measureIds: () => ids,
    mei: () => "",
  };
  host.bindSession(adapter);
  const publish = (version: number) => host.document.set({ id: "doc-1", name: "piece", dirty: false, version, measureCount: ids.length, staffCount: 1, title: "", tempo: null });
  publish(1);
  const panel = () => host.panels.panels.get().find((p) => p.id === PANEL_ID)?.render() as { props: { state: { get(): PdfState }; actions: PdfActions } } | undefined;
  return {
    host,
    loads: () => loads,
    state: () => panel()!.props.state.get(),
    actions: () => panel()!.props.actions,
    panelIds: () => host.panels.panels.get().map((p) => p.id),
    band: () => (host.overlays.specs.get().find((o) => o.id === OVERLAY_ID)?.band as Fixture["band"] extends () => infer B ? B : never) ?? null,
    setIds: (next) => {
      ids = next;
    },
    publish,
    caret: (measureIndex) => host.editor.set({ ...host.editor.get(), caret: { measureIndex, staffN: 1, layerN: 1, eventIndex: 0 } }),
    executed: () => executed,
  };
}

const opened = async (opts: { storage?: ReturnType<typeof memoryStorage> } = {}) => {
  const f = fixture(opts);
  await f.host.registry.runCommand(COMMAND_TOGGLE);
  await flush();
  return f;
};
const cell = (measureIndex: number, measureId: string | null, width = 200): BandCell => ({ measureIndex, measureId, width });

beforeEach(() => {
  rendered.released.length = 0;
});

describe("before any code loads", () => {
  it("the 📄 is declared in the header, and nothing else is there", () => {
    const f = fixture();
    expect(f.host.slots.items.get().header.map((i) => i.id)).toEqual([`${PLUGIN_ID}:toggle`]);
    expect(f.loads()).toBe(0);
    expect(f.panelIds()).toEqual([]);
    expect(f.host.overlays.specs.get()).toEqual([]);
  });
});

describe("the toggle and a load", () => {
  it("opens the bottom panel and its band; a load renders, reads, matches by id", async () => {
    const f = await opened();
    expect(f.panelIds()).toEqual([PANEL_ID]);
    expect(f.band()).not.toBeNull();
    expect(f.band()!.height(cell(0, "a"))).toBe(0); // nothing loaded: no room taken
    f.actions().load(ALL);
    await flush();
    const s = f.state();
    expect(s.status).toBe("ready");
    expect(s.fileName).toBe("piece.pdf");
    expect(s.pages.map((p) => p.url)).toEqual(["blob:fake/1", "blob:fake/2"]);
    expect(s.annotations!.measures.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
    expect(s.matching).toMatchObject({ mode: "id", matched: 4 });
    expect(s.view).toEqual({ page: 1, system: 0 });
    // measure a: 800 wide, its system 300 tall → at 200 px across, 75 px of band
    expect(f.band()!.height(cell(0, "a"))).toBe(75);
    const el = f.band()!.render({ ...cell(0, "a"), height: 90 }) as { props: { measure: { id: string }; image: { url: string }; crop: unknown } };
    expect(el.props.measure.id).toBe("a");
    expect(el.props.image.url).toBe("blob:fake/1");
    expect(el.props.crop).toEqual({ x0: 200, y0: 100, x1: 1000, y1: 400 });
    expect(f.band()!.height(cell(3, "d"))).toBe(60); // page 2's measure
    expect(f.band()!.height(cell(0, "nope"))).toBe(0); // a tile with an id nobody annotated
    expect(f.executed()).toEqual([]);
  });

  it("matches in order when the score's ids are not the annotated ones, and re-matches after an edit", async () => {
    const f = await opened();
    f.setIds(["m1", "m2", "m3"]);
    f.actions().load(ALL);
    await flush();
    expect(f.state().matching).toMatchObject({ mode: "order", matched: 3 });
    expect(f.band()!.height(cell(2, "m3"))).toBeGreaterThan(0); // the third annotated measure, c
    f.setIds(["a", "b", "c", "d"]); // the score now carries the ids
    f.publish(2);
    await flush();
    expect(f.state().matching).toMatchObject({ mode: "id", matched: 4 });
  });
});

describe("following and stepping", () => {
  it("the caret moves the strip to its measure's system; ◀ ▶ step through every system across pages", async () => {
    const f = await opened();
    f.actions().load(ALL);
    await flush();
    f.caret(2);
    expect(f.state().current?.id).toBe("c");
    expect(f.state().view).toEqual({ page: 1, system: 1 });
    f.actions().step(1);
    expect(f.state().view).toEqual({ page: 2, system: 0 });
    f.actions().step(1); // the last system: stays
    expect(f.state().view).toEqual({ page: 2, system: 0 });
    f.actions().step(-1);
    f.actions().step(-1);
    expect(f.state().view).toEqual({ page: 1, system: 0 });
  });
});

describe("the checkbox, clear, a load without its PDF, off", () => {
  it("unchecked, the band asks for nothing; checked, it asks again", async () => {
    const f = await opened();
    f.actions().load(ALL);
    await flush();
    f.actions().setShowBands(false);
    expect(f.band()!.height(cell(0, "a"))).toBe(0);
    expect(f.band()!.render({ ...cell(0, "a"), height: 50 })).toBeNull();
    f.actions().setShowBands(true);
    expect(f.band()!.height(cell(0, "a"))).toBe(75);
  });

  it("clear gives the page images back and keeps the checkbox", async () => {
    const f = await opened();
    f.actions().load(ALL);
    await flush();
    f.actions().setShowBands(false);
    f.actions().clear();
    expect(rendered.released).toEqual(["blob:fake/1", "blob:fake/2"]);
    expect(f.state()).toMatchObject({ status: "empty", pages: [], annotations: null, showBands: false });
  });

  it("annotations alone are kept and say the PDF is needed; files it cannot use are named", async () => {
    const f = await opened();
    f.actions().load([file("piece_page1.json", pageJson(1)), file("notes.txt", "hello")]);
    await flush();
    expect(f.state().status).toBe("error");
    expect(f.state().error).toMatch(/choose the PDF \(or its pages as images\) too/);
    expect(f.state().notes).toEqual(["notes.txt is neither a PDF, an image nor an annotation file"]);
    f.actions().load([file("piece.pdf")]); // the PDF next: the annotations read before are kept
    await flush();
    expect(f.state().status).toBe("ready");
    expect(f.state().annotations?.measures.length).toBe(3);
  });

  it("off takes the panel and the band away, gives the images back, and the declared face returns", async () => {
    const f = await opened();
    f.actions().load(ALL);
    await flush();
    await f.host.registry.setEnabled(PLUGIN_ID, false);
    await flush();
    expect(f.panelIds()).toEqual([]);
    expect(f.host.overlays.specs.get()).toEqual([]);
    expect(rendered.released).toEqual(["blob:fake/1", "blob:fake/2"]);
    await f.host.registry.setEnabled(PLUGIN_ID, true);
    expect(f.host.slots.items.get().header.map((i) => i.id)).toEqual([`${PLUGIN_ID}:toggle`]);
    expect(f.executed()).toEqual([]);
  });
});

describe("drawing systems and measures on a PDF without annotation files", () => {
  const pdfOnly = [file("piece.pdf")];

  it("draws a system and its barlines; the measures place the score's in order and the scans follow the pen", async () => {
    const f = await opened();
    f.actions().load(pdfOnly);
    await flush();
    expect(f.state()).toMatchObject({ status: "ready", source: null, annotations: null });
    f.actions().startDrawing();
    expect(f.state()).toMatchObject({ editing: true, editPage: 1 });
    f.actions().addSystem({ x0: 100, y0: 200, x1: 2000, y1: 500 });
    expect(f.state().annotations?.measures).toHaveLength(1);
    f.actions().setTool("barline");
    f.actions().toggleBarline(700, 300);
    f.actions().toggleBarline(1300, 300);
    const s = f.state();
    expect(s.source).toBe("drawn");
    expect(s.annotations!.measures.map((m) => m.box.x0)).toEqual([100, 700, 1300]);
    expect(s.matching).toMatchObject({ mode: "order", matched: 3 }); // the score's a, b, c
    expect(f.band()!.height(cell(1, "b"))).toBe(100); // 600 wide, 300 tall, at 200 px across
    // a corner dragged: the right edge in past the second barline, the bottom up — one measure fewer, the scans shorter
    f.actions().resizeSystem(0, { x0: 100, y0: 200, x1: 1200, y1: 350 });
    expect(f.state().annotations!.measures.map((m) => [m.box.x0, m.box.x1, m.box.y1])).toEqual([
      [100, 700, 350],
      [700, 1200, 350],
    ]);
    expect(f.band()!.height(cell(1, "b"))).toBe(60); // 500 wide, 150 tall, at 200 px across
    f.actions().resizeSystem(0, { x0: 100, y0: 200, x1: 2000, y1: 500 }); // back out: the dropped barline stays dropped
    expect(f.state().annotations!.measures.map((m) => m.box.x0)).toEqual([100, 700]);
    f.actions().toggleBarline(1300, 300);
    f.actions().stepEditPage(1);
    f.actions().addSystem({ x0: 100, y0: 200, x1: 1100, y1: 500 });
    expect(f.state().annotations!.measures.map((m) => m.page)).toEqual([1, 1, 1, 2]);
    expect(f.state().matching?.matched).toBe(4);
    f.actions().stepEditPage(1); // the last page: stays
    expect(f.state().editPage).toBe(2);
    f.actions().removeSystem(0);
    expect(f.state().annotations!.measures).toHaveLength(3);
    f.actions().stopDrawing();
    expect(f.state()).toMatchObject({ editing: false, view: { page: 1, system: 0 } });
  });

  it("keeps the drawing for that PDF: cleared and loaded again, it comes back", async () => {
    const storage = memoryStorage();
    const f = await opened({ storage });
    f.actions().load(pdfOnly);
    await flush();
    f.actions().startDrawing();
    f.actions().addSystem({ x0: 100, y0: 200, x1: 2000, y1: 500 });
    f.actions().setTool("barline");
    f.actions().toggleBarline(1000, 300);
    f.actions().clear();
    expect(f.state().annotations).toBeNull();
    f.actions().load(pdfOnly);
    await flush();
    expect(f.state()).toMatchObject({ source: "drawn" });
    expect(f.state().annotations!.measures).toHaveLength(2);
    // another PDF (another size) does not find it
    f.actions().load([{ ...file("other.pdf"), arrayBuffer: async () => new ArrayBuffer(16) }]);
    await flush();
    expect(f.state().annotations).toBeNull();
  });

  it("annotation files win: with them, there is nothing to draw", async () => {
    const f = await opened();
    f.actions().load(ALL);
    await flush();
    f.actions().startDrawing();
    expect(f.state().editing).toBe(false);
  });

  it("exports the systems and measures — drawn or read — as the OMR page files, named after the PDF", async () => {
    const f = await opened();
    await expect(f.host.formats.produce(EXPORT_ANNOTATIONS)).rejects.toThrow(/open a PDF in the PDF reference/);
    f.actions().load(ALL);
    await flush();
    const read = (await f.host.formats.produce(EXPORT_ANNOTATIONS)) as { files: { filename: string; bytes: string }[] };
    expect(read.files.map((x) => x.filename)).toEqual(["piece_page1.json", "piece_page2.json"]);
    expect(JSON.parse(read.files[0]!.bytes).annotations.filter((a: { class: string }) => a.class === "measure").map((a: { id: string }) => a.id)).toEqual(["a", "b", "c"]);
    f.actions().clear();
    f.actions().load(pdfOnly);
    await flush();
    f.actions().startDrawing();
    f.actions().addSystem({ x0: 100, y0: 200, x1: 2000, y1: 500 });
    const drawn = (await f.host.formats.produce(EXPORT_ANNOTATIONS)) as { files: { filename: string; bytes: string }[] };
    expect(JSON.parse(drawn.files[0]!.bytes)).toMatchObject({ width: 2100, height: 2970, annotations: [{ class: "system" }, { class: "measure" }] });
  });

  it("the export wakes the plugin without opening its panel", async () => {
    const f = fixture();
    expect(f.host.formats.exports.get().some((x) => x.id === EXPORT_ANNOTATIONS)).toBe(true); // listed before any code loads
    await f.host.formats.produce(EXPORT_ANNOTATIONS).catch(() => undefined);
    await flush();
    expect(f.loads()).toBe(1);
    expect(f.panelIds()).toEqual([]);
  });
});

describe("staves, zoom and pages as images", () => {
  it("splits a drawn system into staves; the caret's staff is followed with its measure", async () => {
    const f = await opened();
    f.actions().load([file("piece.pdf")]);
    await flush();
    f.actions().startDrawing();
    f.actions().addSystem({ x0: 100, y0: 200, x1: 2000, y1: 600 });
    f.actions().setTool("staff");
    f.actions().toggleSplit(500, 400);
    expect(f.state().annotations!.pages[0]!.staves[0]!.map((b) => [b.y0, b.y1])).toEqual([
      [200, 400],
      [400, 600],
    ]);
    f.host.editor.set({ ...f.host.editor.get(), caret: { measureIndex: 0, staffN: 2, layerN: 1, eventIndex: 0 } });
    expect(f.state()).toMatchObject({ currentStaff: 2, current: { order: 0 } });
    f.actions().toggleSplit(500, 405); // on the split: it goes
    expect(f.state().annotations!.pages[0]!.staves[0]).toEqual([]);
  });

  it("zooms the editor in and out through its steps — below the panel's width too — and no further", async () => {
    const f = await opened();
    f.actions().load([file("piece.pdf")]);
    await flush();
    f.actions().startDrawing();
    expect(f.state().editZoom).toBe(1);
    f.actions().zoomEditor(-1);
    expect(f.state().editZoom).toBe(0.75);
    for (let i = 0; i < 6; i++) f.actions().zoomEditor(-1);
    expect(f.state().editZoom).toBe(0.25);
    for (let i = 0; i < 10; i++) f.actions().zoomEditor(1);
    expect(f.state().editZoom).toBe(4);
    f.actions().zoomEditor(-1);
    expect(f.state().editZoom).toBe(3);
  });

  it("takes the pages as images, in their _pageN order, with annotation files, a drawing of their own and an export named after them", async () => {
    const storage = memoryStorage();
    const f = await opened({ storage });
    f.actions().load([file("scan_page2.png"), file("scan_page1.png"), file("piece_page1.json", pageJson(1)), file("piece_page2.json", pageJson(2))]);
    await flush();
    expect(f.state()).toMatchObject({ status: "ready", fileName: "scan_page1.png + 1 more", source: "files" });
    expect(f.state().pages.map((p) => p.url)).toEqual(["blob:img/scan_page1.png", "blob:img/scan_page2.png"]);
    expect(f.band()!.height(cell(0, "a"))).toBe(75); // the files' boxes at the images' own scale
    const exported = (await f.host.formats.produce(EXPORT_ANNOTATIONS)) as { files: { filename: string }[] };
    expect(exported.files.map((x) => x.filename)).toEqual(["scan_page1.json", "scan_page2.json"]);
    // images alone: a drawing, kept for exactly these images
    f.actions().clear();
    f.actions().load([file("scan_page1.png"), file("scan_page2.png")]);
    await flush();
    f.actions().startDrawing();
    f.actions().addSystem({ x0: 100, y0: 200, x1: 2000, y1: 500 });
    f.actions().clear();
    f.actions().load([file("scan_page2.png"), file("scan_page1.png")]); // the same images, picked in another order
    await flush();
    expect(f.state()).toMatchObject({ source: "drawn" });
    expect(f.state().annotations!.measures).toHaveLength(1);
  });

  it("a PDF chosen with images is the PDF, and says so", async () => {
    const f = await opened();
    f.actions().load([file("piece.pdf"), file("scan_page1.png")]);
    await flush();
    expect(f.state().fileName).toBe("piece.pdf");
    expect(f.state().notes).toEqual(["scan_page1.png not used: a PDF was chosen too"]);
  });

  it("on a system pdf.js cannot run on, a PDF says what it needs and is not read; its pages as images are", async () => {
    support.missing = ["Promise.try"];
    try {
      const f = await opened();
      f.actions().load([file("piece.pdf")]);
      await flush();
      expect(f.state().status).toBe("error");
      expect(f.state().error).toMatch(/needs iOS \/ iPadOS 26\.2/);
      expect(f.state().pages).toEqual([]);
      f.actions().load([file("scan_page1.png")]);
      await flush();
      expect(f.state().status).toBe("ready");
      expect(f.state().error).toBeNull();
    } finally {
      support.missing = [];
    }
  });
});
