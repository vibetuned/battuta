/**
 * The third mode (the user, 2026-11-02): a bow drawn from a note to another,
 * as pure functions — the note under the pen, the stroke into a bow, and what
 * the two notes get: a TIE when they are the same note, a SLUR otherwise. The
 * editor still judges (a tie between different pitches is refused there).
 */
import type { Pitch, StylusEvent, StylusScorePoint } from "@battuta/api";
import { crossing, originAt, type Box, type Origins, type Point } from "./handwriting";

/** The note nearest the pen, as `StylusScorePoint` gives it. */
export type NoteAt = NonNullable<StylusScorePoint["nearestNote"]>;

/** Staff spaces beyond a note's body within which the pen is on the note. */
export const BOW_REACH = 1;

/** The note a page point is on: the nearest one, when the point is within `BOW_REACH` spaces of its body. */
export function touching(at: StylusScorePoint | null, p: Point): NoteAt | null {
  const n = at?.nearestNote;
  if (!at || !n) return null;
  const m = BOW_REACH * at.staff.space;
  return p[0] >= n.box.left - m && p[0] <= n.box.right + m && p[1] >= n.box.top - m && p[1] <= n.box.bottom + m ? n : null;
}

const same = (a: Pitch | null, b: Pitch | null): boolean => a !== null && b !== null && a.pname === b.pname && a.oct === b.oct && (a.accid ?? null) === (b.accid ?? null);

/** What a bow between two notes writes: a tie for the same written pitch, a slur for anything else — an unknown pitch included. */
export const bowKind = (from: NoteAt, to: NoteAt): "tie" | "slur" => (same(from.pitch, to.pitch) ? "tie" : "slur");

/** A bow under the pen: the note it started on, its points so far, where it landed, the tiles it has crossed (for the ink). */
export interface Bow {
  id: number;
  from: NoteAt;
  points: Point[];
  landing: { point: Point; at: StylusScorePoint };
  origins: Origins;
}

/** A bow lifted: the note it ended on, or null off any note. */
export interface BowDone {
  from: NoteAt;
  to: NoteAt | null;
  points: Point[];
  landing: Bow["landing"];
}

export const boxOf = (points: readonly Point[]): Box => points.reduce((b, p) => ({ minX: Math.min(b.minX, p[0]), maxX: Math.max(b.maxX, p[0]), minY: Math.min(b.minY, p[1]), maxY: Math.max(b.maxY, p[1]) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

/** The bow after one stroke event: a touch on a note starts it (elsewhere, nothing), the moves extend it, the lift ends it. */
export function bowStep(bow: Bow | null, e: StylusEvent): { bow: Bow | null; done?: BowDone } {
  if (e.type !== "stroke") return { bow };
  const last = e.samples[e.samples.length - 1];
  const points: Point[] = e.samples.map((s) => [s[0], s[1]]);
  if (e.phase === "down") {
    if (!last) return { bow };
    const p: Point = [last[0], last[1]];
    const from = touching(e.at, p);
    return { bow: from && e.at ? { id: e.id, from, points: [p], landing: { point: p, at: e.at }, origins: { [e.at.measureIndex]: originAt(e.at, p) } } : null };
  }
  if (!bow || bow.id !== e.id) return { bow };
  if (e.phase === "move") return { bow: { ...bow, points: [...bow.points, ...points], origins: crossing(bow.origins, e.at, points[points.length - 1]) } };
  if (e.phase === "up") {
    const all = [...bow.points, ...points];
    return { bow: null, done: { from: bow.from, to: touching(e.at, all[all.length - 1]!), points: all, landing: bow.landing } };
  }
  return { bow: null }; // cancel: the bow is lost
}
