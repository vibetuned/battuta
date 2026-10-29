/**
 * Drawing systems and measures: a drag is a system (corners in any order,
 * clamped, too small a drag ignored, systems kept top to bottom); a click
 * in a system adds a barline or takes the one under it away, never too
 * near an edge; measures are the segments between barlines at the system's
 * height; a system's box resized keeps the barlines and splits still
 * inside it; the drawing becomes the same annotations the page files give,
 * writes back out in their format, and a stored drawing is checked.
 */
import { describe, it, expect } from "vitest";
import { addSystem, annotationsFromDrawing, BARLINE_GRAB, emptyDrawing, measuresOf, readDrawing, removeSystem, resizeSystem, stavesOf, systemAt, toPageFiles, toggleBarline, toggleSplit } from "../src/drawing";
import { readAnnotations } from "../src/annotations";

const PAGE = { width: 2100, height: 2970 };
const sys = (y0: number, y1: number) => ({ x0: 100, y0, x1: 2000, y1 });

describe("drawing", () => {
  it("a drag is a system, clamped and ordered top to bottom; a small drag is nothing", () => {
    let d = addSystem(emptyDrawing(), 1, PAGE, { x0: 2000, y0: 700, x1: 100, y1: 400 }); // drawn upwards and leftwards
    d = addSystem(d, 1, PAGE, { x0: -50, y0: 100, x1: 2500, y1: 300 }); // past the page's edges
    expect(d.pages["1"]!.systems.map((s) => s.box)).toEqual([
      { x0: 0, y0: 100, x1: 2100, y1: 300 },
      { x0: 100, y0: 400, x1: 2000, y1: 700 },
    ]);
    expect(addSystem(d, 1, PAGE, { x0: 10, y0: 10, x1: 15, y1: 400 })).toBe(d);
    expect(systemAt(d, 1, 500, 500)).toBe(1);
    expect(systemAt(d, 1, 500, 350)).toBe(-1);
    expect(removeSystem(d, 1, 0).pages["1"]!.systems.map((s) => s.box.y0)).toEqual([400]);
    expect(removeSystem(d, 1, 9)).toBe(d);
  });

  it("a click in a system adds a barline, on one takes it away, near an edge or outside does nothing", () => {
    let d = addSystem(emptyDrawing(), 1, PAGE, sys(100, 400));
    d = toggleBarline(d, 1, 900, 250);
    d = toggleBarline(d, 1, 500, 250);
    expect(d.pages["1"]!.systems[0]!.barlines).toEqual([500, 900]);
    expect(toggleBarline(d, 1, 900 + BARLINE_GRAB - 1, 300).pages["1"]!.systems[0]!.barlines).toEqual([500]); // close enough to grab
    expect(toggleBarline(d, 1, 105, 250)).toBe(d); // the system's own edge
    expect(toggleBarline(d, 1, 900, 600)).toBe(d); // outside every system
    expect(toggleBarline(d, 2, 900, 250)).toBe(d); // a page with nothing drawn
  });

  it("a resized system keeps its marks where they are on the page, drops those it leaves out, and stays in order", () => {
    let d = addSystem(emptyDrawing(), 1, PAGE, sys(100, 400));
    d = addSystem(d, 1, PAGE, sys(500, 800));
    d = toggleBarline(d, 1, 500, 250);
    d = toggleBarline(d, 1, 1500, 250);
    d = toggleSplit(d, 1, 900, 200);
    // the first system's right edge pulled in past its second barline, its top up
    let r = resizeSystem(d, 1, 0, PAGE, { x0: 100, y0: 80, x1: 1200, y1: 400 });
    expect(r.pages["1"]!.systems[0]).toEqual({ box: { x0: 100, y0: 80, x1: 1200, y1: 400 }, barlines: [500], splits: [200] });
    // a barline the new edge comes too near goes too
    expect(resizeSystem(d, 1, 0, PAGE, { x0: 100, y0: 100, x1: 1500 + BARLINE_GRAB - 1, y1: 400 }).pages["1"]!.systems[0]!.barlines).toEqual([500]);
    // a corner dragged past the opposite edge, and past the page: ordered and clamped; moved below the other system, the order follows
    r = resizeSystem(d, 1, 0, PAGE, { x0: 2500, y0: 1000, x1: 0, y1: 850 });
    expect(r.pages["1"]!.systems.map((s) => s.box)).toEqual([sys(500, 800), { x0: 0, y0: 850, x1: 2100, y1: 1000 }]);
    expect(r.pages["1"]!.systems[1]!.splits).toEqual([]); // its split was left above it
    // too small, or no such system: nothing changes
    expect(resizeSystem(d, 1, 0, PAGE, { x0: 100, y0: 100, x1: 110, y1: 400 })).toBe(d);
    expect(resizeSystem(d, 1, 5, PAGE, sys(100, 400))).toBe(d);
    expect(resizeSystem(d, 2, 0, PAGE, sys(100, 400))).toBe(d);
  });

  it("measures are the segments between barlines, at the system's height", () => {
    expect(measuresOf({ box: sys(100, 400), barlines: [500, 900], splits: [] })).toEqual([
      { x0: 100, y0: 100, x1: 500, y1: 400 },
      { x0: 500, y0: 100, x1: 900, y1: 400 },
      { x0: 900, y0: 100, x1: 2000, y1: 400 },
    ]);
    expect(measuresOf({ box: sys(100, 400), barlines: [], splits: [] })).toHaveLength(1);
  });

  it("becomes the annotations the page files give: pages in order, measures numbered across them, no ids", () => {
    let d = addSystem(emptyDrawing(), 2, PAGE, sys(100, 400));
    d = toggleBarline(d, 2, 1000, 200);
    d = addSystem(d, 1, PAGE, sys(100, 400));
    d = addSystem(d, 1, PAGE, sys(600, 900));
    d = addSystem(d, 3, PAGE, sys(100, 400));
    d = removeSystem(d, 3, 0); // a page whose systems were all removed counts for nothing
    const ann = annotationsFromDrawing(d)!;
    expect(ann.pages.map((p) => [p.page, p.systems.length, p.measures.length])).toEqual([
      [1, 2, 2],
      [2, 1, 2],
    ]);
    expect(ann.measures.map((m) => [m.page, m.system, m.order, m.id])).toEqual([
      [1, 0, 0, null],
      [1, 1, 1, null],
      [2, 0, 2, null],
      [2, 0, 3, null],
    ]);
    expect(ann.pages[0]!.width).toBe(2100);
    expect(annotationsFromDrawing(emptyDrawing())).toBeNull();
  });

  it("writes the OMR page format, which reads back to the same measures", () => {
    let d = addSystem(emptyDrawing(), 1, PAGE, sys(100, 400));
    d = toggleBarline(d, 1, 1000.456, 200);
    const files = toPageFiles(annotationsFromDrawing(d)!, "piece", () => null);
    expect(files.map((f) => f.filename)).toEqual(["piece_page1.json"]);
    const json = JSON.parse(files[0]!.text);
    expect(json).toMatchObject({ image: "piece_page1.png", width: 2100, height: 2970 });
    expect(json.annotations).toEqual([
      { class: "system", bbox: [100, 100, 2000, 400] },
      { class: "measure", bbox: [100, 100, 1000.46, 400] },
      { class: "measure", bbox: [1000.46, 100, 2000, 400] },
    ]);
    const back = readAnnotations([{ name: files[0]!.filename, text: files[0]!.text }]).annotations!;
    expect(back.measures.map((m) => m.box.x1)).toEqual([1000.46, 2000]);
  });

  it("a stored drawing is checked: malformed is no drawing", () => {
    const good = addSystem(emptyDrawing(), 1, PAGE, sys(100, 400));
    expect(readDrawing(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(readDrawing(null)).toBeNull();
    expect(readDrawing({ pages: { one: good.pages["1"] } })).toBeNull();
    expect(readDrawing({ pages: { 1: { width: 1, height: 1, systems: [{ box: { x0: 0 }, barlines: [] }] } } })).toBeNull();
    expect(readDrawing({ pages: { 1: { width: 1, height: 1, systems: [{ box: sys(1, 2), barlines: ["x"] }] } } })).toBeNull();
    // drawn before staves existed: no splits is none
    expect(readDrawing({ pages: { 1: { width: 1, height: 1, systems: [{ box: sys(1, 2), barlines: [] }] } } })!.pages["1"]!.systems[0]!.splits).toEqual([]);
    expect(readDrawing({ pages: { 1: { width: 1, height: 1, systems: [{ box: sys(1, 2), barlines: [], splits: "x" }] } } })).toBeNull();
  });
});

describe("staves", () => {
  it("a click in a system splits it at that height, on a split takes it away, near the top or bottom does nothing", () => {
    let d = addSystem(emptyDrawing(), 1, PAGE, sys(100, 700));
    d = toggleSplit(d, 1, 500, 500);
    d = toggleSplit(d, 1, 500, 300);
    expect(d.pages["1"]!.systems[0]!.splits).toEqual([300, 500]);
    expect(stavesOf(d.pages["1"]!.systems[0]!).map((b) => [b.y0, b.y1])).toEqual([
      [100, 300],
      [300, 500],
      [500, 700],
    ]);
    expect(toggleSplit(d, 1, 500, 505).pages["1"]!.systems[0]!.splits).toEqual([300]);
    expect(toggleSplit(d, 1, 500, 105)).toBe(d);
    expect(toggleSplit(d, 1, 500, 900)).toBe(d);
  });

  it("staves become the annotations' staves, and export as system-staff and staff boxes", () => {
    let d = addSystem(emptyDrawing(), 1, PAGE, sys(100, 500));
    d = toggleBarline(d, 1, 1000, 200);
    d = toggleSplit(d, 1, 600, 300);
    const ann = annotationsFromDrawing(d)!;
    expect(ann.pages[0]!.staves[0]!.map((b) => [b.y0, b.y1])).toEqual([
      [100, 300],
      [300, 500],
    ]);
    const json = JSON.parse(toPageFiles(ann, "piece", () => null)[0]!.text);
    const byClass = (c: string) => json.annotations.filter((a: { class: string }) => a.class === c).map((a: { bbox: number[] }) => a.bbox);
    expect(byClass("system-staff")).toEqual([
      [100, 100, 2000, 300],
      [100, 300, 2000, 500],
    ]);
    expect(byClass("staff")).toEqual([
      [100, 100, 1000, 300],
      [100, 300, 1000, 500],
      [1000, 100, 2000, 300],
      [1000, 300, 2000, 500],
    ]);
    // a system never split has no staff boxes: one staff is not something the user said
    expect(annotationsFromDrawing(addSystem(emptyDrawing(), 1, PAGE, sys(100, 500)))!.pages[0]!.staves).toEqual([[]]);
  });
});
