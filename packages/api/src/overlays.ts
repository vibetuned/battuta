/**
 * The overlays extension point (slice 10a, 2026-09-18): what a plugin may
 * DRAW over the notation in edit view — a layer per measure tile, above
 * the score and below the host's own caret and selection, that never
 * touches the SVG. The host measures the tile for the plugin: the boxes of
 * its events and the lines of its staves with the context in force, all
 * in the tile's own CSS pixels (zoom applied), so a plugin maps a pitch or
 * a time to a place without knowing how Verovio laid the measure out.
 *
 * Draw-only: the layer takes no pointer events, so the host's hit-testing
 * underneath is untouched, and it sits over the SVG's own highlights, so
 * draw translucently. A plugin wanting a control puts it in a slot or a
 * panel. Time is not in here: the timemap (`ctx.query.timemap()`) names
 * each measure by the same engraved id, and its notes carry the pitches.
 */
import type { ReactNode } from "react";
import type { Disposable } from "./disposable.js";
import type { StaffContext } from "./document.js";

/** A box in the tile's CSS pixels: origin at the tile's top-left, zoom applied. */
export interface OverlayBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One staff of the tile: the y of each of its lines, top to bottom, and the context in force (clef, key, meter). */
export interface OverlayStaff {
  n: number;
  lines: readonly number[];
  context: StaffContext;
}

/** What the host hands an overlay for one tile — measured again whenever the tile is laid out again (a render, a zoom, a reflow). */
export interface TileOverlayProps {
  /** 0-based index of the measure the tile shows. */
  measureIndex: number;
  /** The measure's engraved id — what the timemap's `measureOn` names — or null when the measure carries none. */
  measureId: string | null;
  /** The tile's box; the layer covers exactly this area. */
  width: number;
  height: number;
  /** The engraved events in the tile (notes, chords, rests) → their box. A note's box is its HEAD (stem and flag excluded), so its centre is the pitch's place; a chord's notes are listed as well as the chord, since the timemap's pitches are per note. */
  boxes: Readonly<Record<string, OverlayBox>>;
  /** The tile's staves in staff order. */
  staves: readonly OverlayStaff[];
}

export interface OverlaySpec {
  /** Unique within the plugin. Adding the same id again replaces the earlier overlay. */
  id: string;
  /** Render over one tile. Called for every rendered tile in edit view while the disposable lives; return null to draw nothing there. */
  render: (tile: TileOverlayProps) => ReactNode;
}

export interface OverlaysService {
  /** Mount an overlay on every tile until disposed (or the plugin deactivates). */
  add(spec: OverlaySpec): Disposable;
}
