/**
 * The serial forms, as pure transformations of `PitchEvent[]`.
 *
 * This file is the shape a plugin's feature logic should have: it knows
 * what a retrograde is and nothing about MEI, XML, commands or the
 * editor. It imports one TYPE from `@battuta/api` and no runtime code at
 * all, which is why it could move out of `@battuta/core` — where it used
 * to sit, inside the host's initial chunk, costing every user its weight
 * at launch whether or not they ever pressed the key.
 *
 * Inversion is DIATONIC, mirrored about each voice's first note.
 * Retrograde reverses pitch CONTENT across the rhythm skeleton —
 * durations and rests stay in place, so measure validity is untouched by
 * construction. Content moves as (pname, oct, accid) triples, so cycling
 * back to prime restores the document byte-identically.
 */
import type { Pitch, PitchEvent } from "@battuta/api";

const PNAMES = ["c", "d", "e", "f", "g", "a", "b"] as const;

export type ReflectionForm = "inversion" | "retrograde" | "retrogradeInversion" | "prime";

/** The cycle, in press order (the fourth press returns to prime). */
export const REFLECTION_CYCLE: ReflectionForm[] = ["inversion", "retrograde", "retrogradeInversion", "prime"];

/** What the notice says for each form. */
export const REFLECTION_LABELS: Record<ReflectionForm, string> = {
  inversion: "inversion",
  retrograde: "retrograde",
  retrogradeInversion: "retrograde inversion",
  prime: "back to the original",
};

const diatonic = (p: Pitch): number => p.oct * 7 + PNAMES.indexOf(p.pname as (typeof PNAMES)[number]);

/**
 * Retrograde moves pitch sets between events, never structure: event i
 * and its mirror must hold the same number of notes.
 */
export const arityPalindromic = (seq: PitchEvent[]): boolean => seq.every((ev, i) => ev.pitches.length === seq[seq.length - 1 - i]!.pitches.length);

/**
 * The target assignment for a form of one voice's BASE sequence: event
 * ids keep their positions, pitch content is transformed. Null when the
 * form is impossible (retrograde over non-mirroring chord sizes).
 */
export function reflectionForm(base: PitchEvent[], form: ReflectionForm): PitchEvent[] | null {
  if (base.length === 0 || base[0]!.pitches.length === 0) return null;
  const anchor = diatonic(base[0]!.pitches[0]!);
  const invert = (p: Pitch): Pitch => {
    const d = 2 * anchor - diatonic(p);
    return { ...p, pname: PNAMES[((d % 7) + 7) % 7]!, oct: Math.floor(d / 7) };
  };
  let content: Pitch[][];
  switch (form) {
    case "prime":
      content = base.map((ev) => ev.pitches);
      break;
    case "inversion":
      content = base.map((ev) => ev.pitches.map(invert));
      break;
    case "retrograde":
    case "retrogradeInversion": {
      if (!arityPalindromic(base)) return null;
      const src = form === "retrograde" ? base.map((ev) => ev.pitches) : base.map((ev) => ev.pitches.map(invert));
      content = src.slice().reverse();
      break;
    }
  }
  return base.map((ev, i) => ({ eventId: ev.eventId, pitches: content[i]! }));
}
