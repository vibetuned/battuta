/**
 * @battuta/core — MEI document core.
 *
 * Constraints (enforced by tsconfig: lib=[ES2022], types=[]):
 *  - No DOM, no I/O, no framework imports. Pure logic over a serializable API.
 *  - Every element keeps its xml:id; ids are the universal currency.
 */

export const CORE_VERSION = "0.1.0";

export { fromDom, serialize, deepClone, findFirst, findAll, childElements, hashString } from "./xml.js";
export type { CoreElement, DomLikeElement, DomLikeNode } from "./xml.js";

export { buildScore } from "./score.js";
export type { CoreScore, ScoreItem, DefItem, MeasureItem } from "./score.js";

export { resolveContexts, contextHash } from "./context.js";
export type { MeasureContext, StaffContext, ClefContext, MeterContext } from "./context.js";

export { synthesizeTile, synthesizeScoreDef } from "./tile.js";
export type { TileSlice } from "./tile.js";

/** Model coordinates used across the whole system (never pixels). */
export interface CaretPosition {
  measureId: string;
  staffN: number;
  layerN: number;
  /** Index of the event in the layer, or a gap position between events. */
  eventIndex: number;
}
