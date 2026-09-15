/**
 * The PERFORMANCE: what the player plays, built from what the host hands
 * out — Verovio's timemap (`ctx.query.timemap()`) and the document's
 * notation facts (`ctx.query.notation()`). This is the player's
 * interpretation, and only the player's: one attack per tie chain held for
 * the merged span; a release gated by the marks (staccato half, legato and
 * tenuto full, everything else slightly detached so legato is audible by
 * contrast); repeat-pass clones sounding as themselves but LIGHTING the
 * engraved note the page actually contains.
 *
 * Moved out of core on 2026-09-15 (slice 7a): core reports ties and
 * marks as facts; what they mean in sound is decided here, and a second
 * player may decide otherwise. Moves into the playback plugin in 7b.
 */
import type { NotationFacts, NoteMark, Timemap, TimemapEvent } from "@battuta/api";

export const GATE_SLUR = 1.0;
export const GATE_TENUTO = 1.0;
export const GATE_STACCATO = 0.5;
export const GATE_STACCATISSIMO = 0.3;
/** Unshaped notes: a slight detach. */
export const GATE_DEFAULT = 0.9;

/** The release gate for a note's marks: an explicit articulation beats the slur's legato. */
export function gateFor(marks: readonly NoteMark[] | undefined): number {
  if (!marks || marks.length === 0) return GATE_DEFAULT;
  if (marks.includes("staccatissimo")) return GATE_STACCATISSIMO;
  if (marks.includes("staccato")) return GATE_STACCATO;
  if (marks.includes("tenuto")) return GATE_TENUTO;
  if (marks.includes("slur")) return GATE_SLUR;
  return GATE_DEFAULT;
}

/**
 * Merge tied spans over the PLAYED timemap (repeat passes play clone ids;
 * `idMap` maps them back to engraved ids for the tie lookup). Returns
 * which played id carries the attack for each note, and the merged
 * duration per attack root. Pure — unit-testable without audio.
 */
export function mergeTiedSpans(
  events: readonly TimemapEvent[],
  ties: Record<string, string>,
  idMap: Record<string, string>,
): { roots: Record<string, string>; durations: Record<string, number> } {
  const vis = (id: string): string => idMap[id] ?? id;
  const onAt = new Map<string, number>();
  const roots: Record<string, string> = {};
  const ends: Record<string, number> = {};
  for (const ev of events) {
    for (const id of ev.off ?? []) {
      const root = roots[id];
      if (root !== undefined) ends[root] = ev.tstamp;
    }
    for (const id of ev.on ?? []) {
      if (onAt.has(id)) continue;
      onAt.set(id, ev.tstamp);
      // a tie continuation starts exactly where its predecessor ends
      const pred = (ev.off ?? []).find((offId) => ties[vis(offId)] === vis(id));
      roots[id] = pred !== undefined ? roots[pred]! : id;
    }
  }
  const durations: Record<string, number> = {};
  for (const [id, root] of Object.entries(roots)) {
    if (id !== root) continue;
    const start = onAt.get(id);
    const end = ends[id];
    if (start !== undefined && end !== undefined) durations[id] = Math.max(60, end - start);
  }
  return { roots, durations };
}

/** One attack: the played id, the engraved id it lights, and the gated, tie-merged length. */
export interface PerfNote {
  id: string;
  visId: string;
  pitch: number;
  onMs: number;
  durMs: number;
}

/** One highlight step, in ENGRAVED ids (the page contains no clones). */
export interface PerfCue {
  atMs: number;
  on: string[];
  off: string[];
  measureOn?: string;
}

export interface Performance {
  /** In time order. */
  notes: PerfNote[];
  /** In time order; every timemap event that turns something on or off or starts a measure. */
  cues: PerfCue[];
  /** The last timemap stamp: the musical length at the score's tempo. */
  totalMs: number;
}

export function buildPerformance(timemap: Timemap, facts: NotationFacts): Performance {
  const vis = (id: string): string => timemap.idMap[id] ?? id;
  // Note lengths from the timemap itself: an id's off minus its on (the
  // fallback when a tie root never sees its end).
  const onAt = new Map<string, number>();
  const durMs = new Map<string, number>();
  for (const ev of timemap.events) {
    for (const id of ev.on ?? []) if (!onAt.has(id)) onAt.set(id, ev.tstamp);
    for (const id of ev.off ?? []) {
      const t0 = onAt.get(id);
      if (t0 !== undefined && !durMs.has(id)) durMs.set(id, Math.max(60, ev.tstamp - t0));
    }
  }
  const { roots, durations } = mergeTiedSpans(timemap.events, facts.ties, timemap.idMap);
  const notes: PerfNote[] = [];
  for (const ev of timemap.events) {
    for (const id of ev.on ?? []) {
      if (roots[id] !== id) continue; // tie continuation: already sounding
      const note = timemap.notes[id];
      if (!note) continue;
      const gate = gateFor(facts.marks[vis(id)]);
      const ms = durations[id] ?? durMs.get(id) ?? 300;
      notes.push({ id, visId: vis(id), pitch: note.pitch, onMs: ev.tstamp, durMs: ms * gate });
    }
  }
  const cues: PerfCue[] = timemap.events
    .filter((ev) => (ev.on?.length ?? 0) + (ev.off?.length ?? 0) > 0 || ev.measureOn)
    .map((ev) => ({ atMs: ev.tstamp, on: (ev.on ?? []).map(vis), off: (ev.off ?? []).map(vis), ...(ev.measureOn ? { measureOn: vis(ev.measureOn) } : {}) }));
  const last = timemap.events[timemap.events.length - 1];
  return { notes, cues, totalMs: last ? last.tstamp : 0 };
}
