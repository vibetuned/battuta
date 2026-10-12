/**
 * Which annotated measure is which measure of the score. BY ID when the
 * score carries the annotated ids — the OMR case: the MEI and its
 * annotations came out of the same pipeline — and IN ORDER otherwise: the
 * score's n-th measure is the n-th annotated one in reading order, which is
 * right for a transcription of the same engraving and says so when the
 * counts differ.
 */
import type { AnnotatedMeasure, Annotations } from "./annotations";

export type MatchMode = "id" | "order";

export interface Matching {
  mode: MatchMode;
  /** The score's measure i → its annotated measure, or null. */
  byIndex: readonly (AnnotatedMeasure | null)[];
  /** How many of the score's measures have one. */
  matched: number;
}

/** By id when at least half of what could match does; in order otherwise. */
export function matchMeasures(ann: Annotations, docIds: readonly (string | null)[]): Matching {
  const hits = docIds.reduce((n, id) => (id !== null && ann.byId.has(id) ? n + 1 : n), 0);
  const mode: MatchMode = hits > 0 && hits >= Math.min(docIds.length, ann.measures.length) / 2 ? "id" : "order";
  const byIndex = docIds.map((id, i) => (mode === "id" ? (id !== null ? (ann.byId.get(id) ?? null) : null) : (ann.measures[i] ?? null)));
  return { mode, byIndex, matched: byIndex.reduce((n, m) => (m ? n + 1 : n), 0) };
}

/** The annotated measure for a tile: by its id in id mode (exact, whatever the order), by its index otherwise. */
export function measureFor(ann: Annotations, m: Matching, measureIndex: number, measureId: string | null): AnnotatedMeasure | null {
  if (m.mode === "id") return measureId !== null ? (ann.byId.get(measureId) ?? null) : null;
  return m.byIndex[measureIndex] ?? null;
}
