/**
 * Reading the annotation files: which page a file is, systems top to
 * bottom, each measure in the system it overlaps most, reading order
 * across pages, rows found when no system is annotated, a graph used only
 * without page files, and every unusable file said — not dropped.
 */
import { describe, it, expect } from "vitest";
import { boxOf, pageFrom, pageNumberOf, readAnnotations } from "../src/annotations";

const m = (id: string, bbox: number[]) => ({ class: "measure", id, bbox });
const sys = (bbox: number[]) => ({ class: "system", bbox });
const pageFile = (n: number, annotations: unknown[]) => ({ name: `piece_page${n}.json`, text: JSON.stringify({ image: `piece_page${n}.png`, width: 2100, height: 2970, annotations }) });

describe("annotations", () => {
  it("reads a box in either corner order, and refuses anything else", () => {
    expect(boxOf([10, 20, 5, 2])).toEqual({ x0: 5, y0: 2, x1: 10, y1: 20 });
    expect(boxOf([1, 2, 3])).toBeNull();
    expect(boxOf([1, 2, 3, "4"])).toBeNull();
    expect(boxOf(null)).toBeNull();
  });

  it("tells the page by the file's name, else by its image", () => {
    expect(pageNumberOf("x_page12.json", {})).toBe(12);
    expect(pageNumberOf("x.json", { image: "x_page3.png" })).toBe(3);
    expect(pageNumberOf("x.json", { image: "x.png" })).toBeNull();
  });

  it("puts each measure in the system it overlaps most, and reads top to bottom, left to right", () => {
    const p = pageFrom(1, 2100, 2970, [
      sys([40, 600, 2050, 900]),
      sys([40, 100, 2050, 400]),
      m("b", [900, 120, 1500, 410]), // reaches a little below its system
      m("a", [200, 90, 900, 400]),
      m("c", [200, 610, 1100, 880]),
      { class: "note", id: "n1", bbox: [1, 1, 2, 2] },
    ]);
    expect(p.systems.map((s) => s.y0)).toEqual([100, 600]);
    expect(p.measures.map((x) => [x.id, x.system])).toEqual([
      ["a", 0],
      ["b", 0],
      ["c", 1],
    ]);
    expect(p.measures[0]!.systemBox).toEqual({ x0: 40, y0: 100, x1: 2050, y1: 400 });
  });

  it("without annotated systems, the measures' own rows are the systems", () => {
    const p = pageFrom(1, null, null, [m("r2", [100, 600, 500, 800]), m("r1b", [500, 100, 900, 300]), m("r1a", [100, 110, 500, 290])]);
    expect(p.systems).toHaveLength(2);
    expect(p.measures.map((x) => [x.id, x.system])).toEqual([
      ["r1a", 0],
      ["r1b", 0],
      ["r2", 1],
    ]);
  });

  it("orders the piece across pages, whatever order the files came in, and finds a measure by id", () => {
    const { annotations, notes } = readAnnotations([pageFile(2, [sys([0, 0, 2000, 300]), m("p2a", [0, 0, 500, 300])]), pageFile(1, [sys([0, 0, 2000, 300]), m("p1b", [600, 0, 900, 300]), m("p1a", [0, 0, 600, 300])])]);
    expect(notes).toEqual([]);
    expect(annotations!.measures.map((x) => [x.id, x.page, x.order])).toEqual([
      ["p1a", 1, 0],
      ["p1b", 1, 1],
      ["p2a", 2, 2],
    ]);
    expect(annotations!.byId.get("p2a")?.order).toBe(2);
    expect(annotations!.pages.map((p) => [p.page, p.width])).toEqual([
      [1, 2100],
      [2, 2100],
    ]);
  });

  it("uses a graph only without page files, and says so when it is not needed", () => {
    const graph = { name: "piece.graph.json", text: JSON.stringify({ nodes: [{ class: "system", bbox: [0, 0, 2000, 300], page: 1 }, { class: "measure", id: "g1", bbox: [0, 0, 500, 300], page: 1 }, { class: "measure", id: "g2", bbox: [0, 0, 500, 300], page: 2 }] }) };
    const alone = readAnnotations([graph]);
    expect(alone.annotations!.measures.map((x) => x.id)).toEqual(["g1", "g2"]);
    expect(alone.annotations!.pages[0]!.width).toBeNull(); // the rendered page is taken as the image
    const both = readAnnotations([graph, pageFile(1, [m("p1", [0, 0, 1, 1])])]);
    expect(both.annotations!.measures.map((x) => x.id)).toEqual(["p1"]);
    expect(both.notes).toEqual(["piece.graph.json not needed: the page files carry the same boxes"]);
  });

  it("says why a file cannot be used, and reads the rest", () => {
    const { annotations, notes } = readAnnotations([
      { name: "broken.json", text: "{" },
      { name: "other.json", text: JSON.stringify({ hello: 1 }) },
      { name: "nameless.json", text: JSON.stringify({ annotations: [] }) },
      pageFile(1, [m("a", [0, 0, 1, 1])]),
      pageFile(1, [m("b", [0, 0, 1, 1])]),
    ]);
    expect(notes).toEqual([
      "broken.json is not JSON",
      "other.json is not an annotation file",
      "nameless.json: cannot tell which page it annotates (expected …_page<N>.json)",
      "page 1 was given twice; piece_page1.json is used",
    ]);
    expect(annotations!.measures.map((x) => x.id)).toEqual(["b"]);
    expect(readAnnotations([]).annotations).toBeNull();
  });
});

describe("staves from the files", () => {
  it("puts each system-staff box in the system it overlaps most, top to bottom", () => {
    const p = pageFrom(1, 2100, 2970, [
      sys([40, 100, 2050, 400]),
      sys([40, 600, 2050, 900]),
      { class: "system-staff", bbox: [100, 300, 2050, 380] },
      { class: "system-staff", bbox: [100, 120, 2050, 200] },
      { class: "system-staff", bbox: [100, 650, 2050, 720] },
    ]);
    expect(p.staves.map((list) => list.map((b) => b.y0))).toEqual([[120, 300], [650]]);
  });
});
