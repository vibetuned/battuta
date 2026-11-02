/**
 * Handwriting's first half, as a pure function: stylus events in, the symbol
 * being written — and, when it is done, the symbol to read. A symbol is the
 * strokes that follow each other closely: the next stroke lands within
 * `GAP_MS` of the last lift and within reach of the symbol's box — a reach
 * that grows with the drawing (`marginOf`: half its larger side, at least
 * `GAP_MIN_SPACES` staff spaces), so a sharp's four strokes and a natural's
 * three join, while a staccato written right after a staccato on the next
 * note is a symbol of its own (the user, 2026-11-02: small glyphs must
 * follow each other quickly). A lift starts the clock; a stroke landing
 * elsewhere, or the clock running out (`tick`), ends the symbol. The plugin
 * keeps the clock (`index.tsx`); nothing here does.
 */
import type { StylusEvent, StylusScorePoint } from "@battuta/api";

/** A page point, px. */
export type Point = readonly [x: number, y: number];

export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Ms after a lift within which the next stroke still belongs to the symbol. */
export const GAP_MS = 600;
/** The reach beyond the symbol's box, as a fraction of its larger side: within it the next stroke still belongs to the symbol. */
export const GAP_RATIO = 0.5;
/** The least reach, in staff spaces: a dot's box is a point, and the pen lands a little off. */
export const GAP_MIN_SPACES = 0.5;

/** The page origin of every measure tile the pen has crossed, by measure index: what each tile's overlay draws the ink in. */
export type Origins = Readonly<Record<number, Point>>;

/** A tile's page origin from a point on it and the host's reading of that point (the point in the tile's own px). */
export const originAt = (at: StylusScorePoint, p: Point): Point => [p[0] - at.tile.x, p[1] - at.tile.y];

/** `origins` with the tile under `at` added, when it is new. */
export const crossing = (origins: Origins, at: StylusScorePoint | null, p: Point | undefined): Origins => (at && p && !(at.measureIndex in origins) ? { ...origins, [at.measureIndex]: originAt(at, p) } : origins);

/** A symbol under the pen: its finished strokes, the stroke being drawn, where the first landed. */
export interface Writing {
  strokes: Point[][];
  live: { id: number; points: Point[] } | null;
  box: Box;
  /** Where the first stroke landed: its page point and the host's reading of it. */
  landing: { point: Point; at: StylusScorePoint };
  /** The tiles the pen has crossed, for the ink (the user, 2026-11-02: a symbol or a bow is drawn all over the row, not in one measure). */
  origins: Origins;
  /** When the symbol ends unless another stroke lands first; null while the pen is down. */
  deadline: number | null;
}

/** A finished symbol: at least one stroke of at least one point. */
export interface Symbol {
  strokes: Point[][];
  box: Box;
  landing: Writing["landing"];
}

export interface Grouped {
  writing: Writing | null;
  /** The symbol that just ended, if one did. */
  done?: Symbol;
}

const boxOf = (p: Point): Box => ({ minX: p[0], maxX: p[0], minY: p[1], maxY: p[1] });

const grow = (b: Box, p: Point): Box => ({ minX: Math.min(b.minX, p[0]), maxX: Math.max(b.maxX, p[0]), minY: Math.min(b.minY, p[1]), maxY: Math.max(b.maxY, p[1]) });

/** Within `margin` px of the box. */
export const near = (b: Box, p: Point, margin: number): boolean => p[0] >= b.minX - margin && p[0] <= b.maxX + margin && p[1] >= b.minY - margin && p[1] <= b.maxY + margin;

/** How far beyond its box a symbol reaches for its next stroke, px: proportional to the drawing, never under half a space. */
export const marginOf = (b: Box, staffSpace: number): number => Math.max(GAP_MIN_SPACES * staffSpace, GAP_RATIO * Math.max(b.maxX - b.minX, b.maxY - b.minY));

const finish = (w: Writing): Symbol | undefined => (w.strokes.length > 0 ? { strokes: w.strokes, box: w.box, landing: w.landing } : undefined);

/** The symbol after one stroke event, at `now` ms. */
export function group(w: Writing | null, e: StylusEvent, now: number): Grouped {
  if (e.type !== "stroke") return { writing: w };
  const sample = e.samples[e.samples.length - 1];
  const points: Point[] = e.samples.map((s) => [s[0], s[1]]);
  if (e.phase === "down") {
    if (!sample || !e.at) return { writing: w }; // off the score: the page's, not a symbol's
    const p: Point = [sample[0], sample[1]];
    if (w && !w.live && (w.deadline === null || now <= w.deadline) && near(w.box, p, marginOf(w.box, w.landing.at.staff.space))) {
      return { writing: { ...w, live: { id: e.id, points: [p] }, box: grow(w.box, p), origins: crossing(w.origins, e.at, p), deadline: null } };
    }
    const done = w ? finish(w) : undefined;
    return { writing: { strokes: [], live: { id: e.id, points: [p] }, box: boxOf(p), landing: { point: p, at: e.at }, origins: { [e.at.measureIndex]: originAt(e.at, p) }, deadline: null }, ...(done && { done }) };
  }
  if (!w?.live || w.live.id !== e.id) return { writing: w };
  const last = points[points.length - 1];
  if (e.phase === "move") {
    return { writing: { ...w, live: { id: e.id, points: [...w.live.points, ...points] }, box: points.reduce(grow, w.box), origins: crossing(w.origins, e.at, last) } };
  }
  if (e.phase === "up") {
    const stroke = [...w.live.points, ...points];
    return { writing: { ...w, strokes: [...w.strokes, stroke], live: null, box: points.reduce(grow, w.box), origins: crossing(w.origins, e.at, last), deadline: now + GAP_MS } };
  }
  // cancel: the stroke is lost; what was written before it stays, on the clock.
  if (w.strokes.length === 0) return { writing: null };
  return { writing: { ...w, live: null, deadline: now + GAP_MS } };
}

/** The clock, at `now` ms: the symbol ends when its deadline has passed and the pen is up. */
export function tick(w: Writing | null, now: number): Grouped {
  if (!w || w.live || w.deadline === null || now < w.deadline) return { writing: w };
  const done = finish(w);
  return { writing: null, ...(done && { done }) };
}
