/**
 * Systems and measures DRAWN on a PDF that came without annotation files
 * (2026-10-11, the user: "create the system and the measures in any random
 * PDF"). The gesture is the engraver's: a box across a system, then a click
 * at each barline — the measures are the segments between the barlines, at
 * the system's full height, which is what an OMR measure box is. Two
 * gestures a system, rather than one box a measure.
 *
 * Coordinates are the rendered page's pixels (254 dpi, as every page is
 * rendered), so a drawing IS an annotation set at scale 1: it becomes the
 * same `Annotations` the page files give, and it writes back out in their
 * format. Pure functions; the plugin persists a drawing per PDF.
 */
import type { AnnotatedMeasure, AnnotatedPage, Annotations, Box } from "./annotations";

export interface DrawnSystem {
  box: Box;
  /** Barline x positions, strictly inside the box, ascending. */
  barlines: number[];
  /** Staff boundaries: y positions strictly inside the box, ascending — the system's staves are the bands between them. */
  splits: number[];
}

export interface DrawnPage {
  /** The rendered page's size. */
  width: number;
  height: number;
  /** Top to bottom. */
  systems: DrawnSystem[];
}

/** Page number → its drawn page (a record, so it stores as JSON). */
export interface Drawing {
  pages: Record<string, DrawnPage>;
}

/** A drag smaller than this (rendered pixels, either way) is a click, not a system. */
export const MIN_SYSTEM = 20;
/** A barline click this close to an existing barline removes it; and no barline this close to a system's edge. */
export const BARLINE_GRAB = 12;

export const emptyDrawing = (): Drawing => ({ pages: {} });

/** Where the plugin keeps a PDF's drawing: by its name and size, so the same file finds it again. */
export const drawingKey = (fileName: string, bytes: number): string => `drawing:${fileName}:${bytes}`;

const withPage = (d: Drawing, page: number, p: DrawnPage): Drawing => ({ pages: { ...d.pages, [String(page)]: p } });
const pageOf = (d: Drawing, page: number, size: { width: number; height: number }): DrawnPage => d.pages[String(page)] ?? { width: size.width, height: size.height, systems: [] };

/** A drag's box: corners in any order, clamped to the page — or null when it is too small to be a system. */
const systemBox = (drag: Box, size: { width: number; height: number }): Box | null => {
  const box: Box = {
    x0: Math.max(0, Math.min(drag.x0, drag.x1)),
    y0: Math.max(0, Math.min(drag.y0, drag.y1)),
    x1: Math.min(size.width, Math.max(drag.x0, drag.x1)),
    y1: Math.min(size.height, Math.max(drag.y0, drag.y1)),
  };
  return box.x1 - box.x0 < MIN_SYSTEM || box.y1 - box.y0 < MIN_SYSTEM ? null : box;
};

/** Add a system from a drag, corners in any order, clamped to the page. Too small a drag changes nothing. */
export function addSystem(d: Drawing, page: number, size: { width: number; height: number }, drag: Box): Drawing {
  const box = systemBox(drag, size);
  if (!box) return d;
  const p = pageOf(d, page, size);
  const systems = [...p.systems, { box, barlines: [], splits: [] }].sort((a, b) => a.box.y0 - b.box.y0);
  return withPage(d, page, { ...p, systems });
}

/**
 * A system's box changed — a corner dragged (2026-10-29, the user: "we
 * cannot resize the systems"). Corners in any order, clamped to the page;
 * the barlines and splits stay where they are on the page, and the ones
 * the new box leaves out, or brings too near its edges, go. Too small a
 * box changes nothing. The systems stay top to bottom.
 */
export function resizeSystem(d: Drawing, page: number, index: number, size: { width: number; height: number }, drag: Box): Drawing {
  const p = d.pages[String(page)];
  const s = p?.systems[index];
  const box = systemBox(drag, size);
  if (!p || !s || !box) return d;
  const barlines = s.barlines.filter((x) => x - box.x0 > BARLINE_GRAB && box.x1 - x > BARLINE_GRAB);
  const splits = s.splits.filter((y) => y - box.y0 > BARLINE_GRAB && box.y1 - y > BARLINE_GRAB);
  const systems = p.systems.map((x, k) => (k === index ? { box, barlines, splits } : x)).sort((a, b) => a.box.y0 - b.box.y0);
  return withPage(d, page, { ...p, systems });
}

export function removeSystem(d: Drawing, page: number, index: number): Drawing {
  const p = d.pages[String(page)];
  if (!p || !p.systems[index]) return d;
  return withPage(d, page, { ...p, systems: p.systems.filter((_, i) => i !== index) });
}

/** The system a point is in, or -1. */
export function systemAt(d: Drawing, page: number, x: number, y: number): number {
  const p = d.pages[String(page)];
  return p ? p.systems.findIndex((s) => x >= s.box.x0 && x <= s.box.x1 && y >= s.box.y0 && y <= s.box.y1) : -1;
}

/** A click in a system: on a barline it removes it, elsewhere it adds one there. Outside every system, or too near an edge, nothing. */
export function toggleBarline(d: Drawing, page: number, x: number, y: number): Drawing {
  const i = systemAt(d, page, x, y);
  if (i < 0) return d;
  const p = d.pages[String(page)]!;
  const s = p.systems[i]!;
  const near = s.barlines.findIndex((b) => Math.abs(b - x) <= BARLINE_GRAB);
  let barlines: number[];
  if (near >= 0) barlines = s.barlines.filter((_, k) => k !== near);
  else if (x - s.box.x0 > BARLINE_GRAB && s.box.x1 - x > BARLINE_GRAB) barlines = [...s.barlines, x].sort((a, b) => a - b);
  else return d;
  const systems = p.systems.map((x2, k) => (k === i ? { ...s, barlines } : x2));
  return withPage(d, page, { ...p, systems });
}

/** A click in a system with the staves tool: on a split it removes it, elsewhere it adds one at that height. Outside every system, or too near its top or bottom, nothing. */
export function toggleSplit(d: Drawing, page: number, x: number, y: number): Drawing {
  const i = systemAt(d, page, x, y);
  if (i < 0) return d;
  const p = d.pages[String(page)]!;
  const s = p.systems[i]!;
  const near = s.splits.findIndex((v) => Math.abs(v - y) <= BARLINE_GRAB);
  let splits: number[];
  if (near >= 0) splits = s.splits.filter((_, k) => k !== near);
  else if (y - s.box.y0 > BARLINE_GRAB && s.box.y1 - y > BARLINE_GRAB) splits = [...s.splits, y].sort((a, b) => a - b);
  else return d;
  const systems = p.systems.map((x2, k) => (k === i ? { ...s, splits } : x2));
  return withPage(d, page, { ...p, systems });
}

/** A system's staves: the bands between its top, its splits and its bottom, across its width. One staff when it has no split. */
export function stavesOf(s: DrawnSystem): Box[] {
  const edges = [s.box.y0, ...s.splits, s.box.y1];
  return edges.slice(1).map((y1, k) => ({ x0: s.box.x0, y0: edges[k]!, x1: s.box.x1, y1 }));
}

/** A system's measures: the segments between its edges and its barlines, each the system's full height. */
export function measuresOf(s: DrawnSystem): Box[] {
  const edges = [s.box.x0, ...s.barlines, s.box.x1];
  return edges.slice(1).map((x1, k) => ({ x0: edges[k]!, y0: s.box.y0, x1, y1: s.box.y1 }));
}

/** The drawing as annotations — the same shape the page files give, at scale 1, without ids — or null when nothing is drawn. */
export function annotationsFromDrawing(d: Drawing): Annotations | null {
  const pages: AnnotatedPage[] = [];
  const all: AnnotatedMeasure[] = [];
  for (const key of Object.keys(d.pages).sort((a, b) => Number(a) - Number(b))) {
    const p = d.pages[key]!;
    if (p.systems.length === 0) continue;
    const page = Number(key);
    const measures: AnnotatedMeasure[] = [];
    p.systems.forEach((s, system) => {
      for (const box of measuresOf(s)) {
        const m: AnnotatedMeasure = { id: null, page, system, box, systemBox: s.box, order: all.length };
        measures.push(m);
        all.push(m);
      }
    });
    // a system without splits has no staff boxes: "one staff" is not something the user said
    pages.push({ page, width: p.width, height: p.height, systems: p.systems.map((s) => s.box), staves: p.systems.map((s) => (s.splits.length ? stavesOf(s) : [])), measures });
  }
  return all.length ? { pages, measures: all, byId: new Map() } : null;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const bbox = (b: Box): number[] => [r2(b.x0), r2(b.y0), r2(b.x1), r2(b.y1)];

/**
 * Annotations — drawn or read — written back out as the OMR pipeline's page
 * files: `<base>_page<N>.json`, `{ image, width, height, annotations }`, a
 * `system` box per system and a `measure` box per measure (with its id when
 * it has one). What a drawing exports, and what another tool reads.
 */
export function toPageFiles(ann: Annotations, base: string, sizes: (page: number) => { width: number; height: number } | null): { filename: string; text: string }[] {
  return ann.pages.map((p) => {
    const size = p.width && p.height ? { width: p.width, height: p.height } : sizes(p.page);
    // the OMR classes: a `system-staff` per staff of a system, and a `staff`
    // per measure and staff — the measure's width by the staff's height
    const staffBoxes = p.measures.flatMap((m) => (p.staves[m.system] ?? []).map((st) => ({ class: "staff", bbox: bbox({ x0: m.box.x0, y0: st.y0, x1: m.box.x1, y1: st.y1 }) })));
    const annotations = [
      ...p.systems.map((s) => ({ class: "system", bbox: bbox(s) })),
      ...p.staves.flatMap((list) => list.map((st) => ({ class: "system-staff", bbox: bbox(st) }))),
      ...p.measures.map((m) => ({ class: "measure", bbox: bbox(m.box), ...(m.id !== null ? { id: m.id } : {}) })),
      ...staffBoxes,
    ];
    return { filename: `${base}_page${p.page}.json`, text: JSON.stringify({ image: `${base}_page${p.page}.png`, width: size?.width ?? null, height: size?.height ?? null, annotations }, null, 1) };
  });
}

const isBox = (b: unknown): b is Box => {
  const o = b as Box | null;
  return !!o && [o.x0, o.y0, o.x1, o.y1].every((n) => typeof n === "number" && Number.isFinite(n));
};

/** A stored drawing, checked — anything malformed is no drawing (storage is the user's machine, not a contract). */
export function readDrawing(raw: unknown): Drawing | null {
  const pages = (raw as Drawing | null)?.pages;
  if (!pages || typeof pages !== "object") return null;
  const out: Drawing = { pages: {} };
  for (const [key, p] of Object.entries(pages)) {
    if (!/^\d+$/.test(key) || !p || typeof p.width !== "number" || typeof p.height !== "number" || !Array.isArray(p.systems)) return null;
    const systems: DrawnSystem[] = [];
    for (const s of p.systems) {
      if (!isBox(s?.box) || !Array.isArray(s.barlines) || !s.barlines.every((b: unknown) => typeof b === "number" && Number.isFinite(b))) return null;
      // `splits` arrived after the first drawings were kept: absent is none
      const splits = (s as { splits?: unknown }).splits;
      if (splits !== undefined && (!Array.isArray(splits) || !splits.every((v: unknown) => typeof v === "number" && Number.isFinite(v)))) return null;
      systems.push({ box: s.box, barlines: [...s.barlines].sort((a, b) => a - b), splits: [...((splits as number[] | undefined) ?? [])].sort((a, b) => a - b) });
    }
    out.pages[key] = { width: p.width, height: p.height, systems };
  }
  return out;
}
