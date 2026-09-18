/**
 * The overlays point (slice 10a, 2026-09-18): a plugin draws over every
 * measure tile in edit view without touching the SVG. The store holds the
 * specs; `<TileOverlays>` is mounted by the tile grid inside each tile's
 * aligned box, measures the tile's events and staff lines once per layout,
 * and renders every spec with the result. It measures nothing while no
 * overlay is registered, so an editor without such a plugin pays one
 * subscription per tile and not one layout read.
 *
 * Coordinates are the tile's own CSS pixels — zoom applied, origin at the
 * box's top-left: the layer covers the box exactly, so an overlay's
 * absolutely positioned children land where its numbers say. The layer
 * takes no pointer events; the host's hit-testing underneath is untouched.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { toDisposable, type Disposable, type OverlayBox, type OverlaySpec, type OverlayStaff, type StaffContext, type TileOverlayProps } from "@battuta/api";
import { createStore, useStore } from "./store";

export interface RegisteredOverlay extends OverlaySpec {
  pluginId: string;
}

export class OverlayStore {
  readonly specs = createStore<readonly RegisteredOverlay[]>([]);

  /** Keyed by plugin and id: the same plugin adding the same id replaces its earlier overlay. */
  add(spec: OverlaySpec, pluginId: string): Disposable {
    const entry: RegisteredOverlay = { ...spec, pluginId };
    this.specs.update((s) => [...s.filter((x) => !(x.pluginId === pluginId && x.id === spec.id)), entry]);
    return toDisposable(() => this.specs.update((s) => s.filter((x) => x !== entry)));
  }
}

/** A measured rectangle in viewport coordinates — what getBoundingClientRect answers. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The engraved groups an overlay gets a box for (Verovio's classes). */
export const EVENT_CLASSES = ["note", "chord", "rest", "mRest", "space"] as const;

/** One tile as read from the DOM, before projection. */
export interface TileMeasurement {
  /** The layer's own box — the origin and extent of everything else. */
  origin: Rect;
  events: readonly { id: string; rect: Rect }[];
  /** Each `g.staff` and the rectangles of its line paths. */
  staves: readonly { id: string; lines: readonly Rect[] }[];
}

/** Project measured rectangles into the tile's own pixels. Pure — the DOM reads are `measureTile`'s. */
export function tileGeometry(m: TileMeasurement, staffNOf: (staffId: string) => number | undefined, contextOf: (n: number) => StaffContext | undefined): Pick<TileOverlayProps, "width" | "height" | "boxes" | "staves"> {
  const rel = (r: Rect): OverlayBox => ({ x: r.left - m.origin.left, y: r.top - m.origin.top, width: r.width, height: r.height });
  const boxes: Record<string, OverlayBox> = {};
  for (const e of m.events) boxes[e.id] = rel(e.rect);
  const staves: OverlayStaff[] = [];
  for (const s of m.staves) {
    const n = staffNOf(s.id);
    const context = n === undefined ? undefined : contextOf(n);
    if (n === undefined || !context) continue; // a staff the document does not know (a header cell's) draws nothing
    const lines = s.lines.map((l) => l.top + l.height / 2 - m.origin.top).sort((a, b) => a - b);
    staves.push({ n, lines, context });
  }
  staves.sort((a, b) => a.n - b.n);
  return { width: m.origin.width, height: m.origin.height, boxes, staves };
}

/**
 * A note's box is its HEAD (Verovio wraps it in `g.notehead`): the stem
 * would put the box's centre a fifth away from the pitch, and a pitch
 * axis is the first thing a consumer fits through these boxes (10b).
 * Every other event is its own group.
 */
const glyphOf = (g: SVGGElement): Element => (g.classList.contains("note") && g.querySelector(":scope > g.notehead")) || g;

/** Read one tile off the DOM: the layer's parent is the aligned box holding the tile's SVG. */
export function measureTile(layer: HTMLElement): TileMeasurement {
  const root = layer.parentElement ?? layer;
  const origin = layer.getBoundingClientRect();
  const events = [...root.querySelectorAll<SVGGElement>(EVENT_CLASSES.map((c) => `g.${c}[id]`).join(","))].map((g) => ({ id: g.id, rect: glyphOf(g).getBoundingClientRect() }));
  const staves = [...root.querySelectorAll<SVGGElement>("g.staff[id]")].map((g) => ({
    id: g.id,
    lines: [...g.children].filter((c) => c.tagName === "path").map((p) => p.getBoundingClientRect()),
  }));
  return { origin, events, staves };
}

const LAYER: React.CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };
const FILL: React.CSSProperties = { position: "absolute", inset: 0 };

/**
 * The layer over one tile. `layoutKey` names everything that moves the
 * tile's ink (its rendered variant, the zoom, the row's baseline and box):
 * the layer re-measures when it changes and not on every grid render.
 */
export function TileOverlays({ store, measureIndex, measureId, layoutKey, staffNOf, contextOf }: { store: OverlayStore; measureIndex: number; measureId: string | null; layoutKey: string; staffNOf: (staffId: string) => number | undefined; contextOf: (measureIndex: number, n: number) => StaffContext | undefined }) {
  const specs = useStore(store.specs);
  const ref = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Pick<TileOverlayProps, "width" | "height" | "boxes" | "staves"> | null>(null);
  const active = specs.length > 0;
  useLayoutEffect(() => {
    if (!active || !ref.current) return;
    setGeo(tileGeometry(measureTile(ref.current), staffNOf, (n) => contextOf(measureIndex, n)));
  }, [active, layoutKey, measureIndex, staffNOf, contextOf]);
  if (!active) return null;
  const tile: TileOverlayProps | null = geo ? { measureIndex, measureId, ...geo } : null;
  return (
    <div ref={ref} data-overlays={measureIndex} style={LAYER}>
      {tile &&
        specs.map((s) => (
          <div key={`${s.pluginId}:${s.id}`} data-overlay={s.id} data-plugin={s.pluginId} style={FILL}>
            {s.render(tile)}
          </div>
        ))}
    </div>
  );
}
