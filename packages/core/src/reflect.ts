/**
 * Reflection cycle (shift+R on a block): the classic serial forms of the
 * selected material — Prime → Inversion → Retrograde → Retrograde
 * Inversion → Prime. Inversion is DIATONIC, mirrored about each voice's
 * first note; retrograde reverses the pitch CONTENT across the rhythm
 * skeleton — durations and rests stay in place, so measure validity is
 * untouched by construction. Pitch content moves as (pname, oct, accid)
 * triples, so cycling back to prime restores the document byte-
 * identically. The editor holds the base form while cycling and derives
 * every form from it (no compounding drift).
 */
import { CoreElement, childElements } from "./xml.js";
import { Command, CommandContext, DirtyRegion, targetNotes } from "./commands.js";
import { CoreScore } from "./score.js";
import { EventIndex } from "./events.js";

const PNAMES = ["c", "d", "e", "f", "g", "a", "b"] as const;

export interface Pitch {
  pname: string;
  oct: number;
  accid?: string;
  accidGes?: string;
}

/** One pitched event (note or chord) in voice order. */
export interface PitchEvent {
  eventId: string;
  pitches: Pitch[];
}

export type ReflectionForm = "inversion" | "retrograde" | "retrogradeInversion" | "prime";

/** The cycle, in press order (the fourth press returns to prime). */
export const REFLECTION_CYCLE: ReflectionForm[] = ["inversion", "retrograde", "retrogradeInversion", "prime"];

export const REFLECTION_LABELS: Record<ReflectionForm, string> = {
  inversion: "inversion",
  retrograde: "retrograde",
  retrogradeInversion: "retrograde inversion",
  prime: "back to the original",
};

const diatonic = (p: Pitch): number => p.oct * 7 + PNAMES.indexOf(p.pname as (typeof PNAMES)[number]);

/**
 * The pitched events of a block, one sequence per (staff, layer) voice,
 * in measure order. Rests and repeats are rhythm, not pitch — skipped.
 */
export function collectPitchEvents(score: CoreScore, index: EventIndex, measureFrom: number, measureTo: number, staffFrom: number, staffTo: number): PitchEvent[][] {
  const voices = new Map<string, PitchEvent[]>();
  for (let m = measureFrom; m <= measureTo; m++) {
    for (const s of index.stavesPerMeasure.get(m) ?? []) {
      if (s < staffFrom || s > staffTo) continue;
      for (const l of index.layersPerStaff.get(`${m}/${s}`) ?? []) {
        for (const id of index.eventsAt(m, s, l)) {
          const ref = index.byId.get(id);
          if (!ref || (ref.tag !== "note" && ref.tag !== "chord")) continue;
          const notes = targetNotes({ score, index }, id);
          const pitches: Pitch[] = notes.map((n) => ({
            pname: n.attrs["pname"] ?? "c",
            oct: Number(n.attrs["oct"] ?? "4"),
            ...(n.attrs["accid"] !== undefined ? { accid: n.attrs["accid"] } : {}),
            ...(n.attrs["accid.ges"] !== undefined ? { accidGes: n.attrs["accid.ges"] } : {}),
          }));
          if (pitches.length === 0) continue;
          const key = `${s}/${l}`;
          if (!voices.has(key)) voices.set(key, []);
          voices.get(key)!.push({ eventId: id, pitches });
        }
      }
    }
  }
  return [...voices.values()].filter((seq) => seq.length > 0);
}

/** Retrograde moves pitch sets between events, never structure: event i
 * and its mirror must hold the same number of notes. */
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

/**
 * Write pitch content onto events (notes in child order for chords) —
 * the generic write half of the reflection cycle. Full-attr mementos,
 * byte-identical revert.
 */
export class SetPitchesCommand implements Command {
  readonly label: string;
  private mementos: { el: CoreElement; before: Record<string, string> }[] = [];
  private region: DirtyRegion[] = [];

  constructor(
    private readonly targets: PitchEvent[],
    label = "reflect",
  ) {
    this.label = label;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    this.mementos = [];
    const regions = new Map<string, DirtyRegion>();
    for (const t of this.targets) {
      const notes = targetNotes(ctx, t.eventId);
      if (notes.length !== t.pitches.length) throw new Error("pitch count does not match the event");
      const ref = ctx.index.byId.get(t.eventId);
      if (ref) regions.set(`${ref.measureIndex}/${ref.staffN}`, { measureIndex: ref.measureIndex, staffN: ref.staffN });
      notes.forEach((el, k) => {
        const p = t.pitches[k]!;
        this.mementos.push({ el, before: { ...el.attrs } });
        el.attrs["pname"] = p.pname;
        el.attrs["oct"] = String(p.oct);
        if (p.accid === undefined) delete el.attrs["accid"];
        else el.attrs["accid"] = p.accid;
        if (p.accidGes === undefined) delete el.attrs["accid.ges"];
        else el.attrs["accid.ges"] = p.accidGes;
      });
    }
    this.region = [...regions.values()];
    return this.region;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    for (const m of [...this.mementos].reverse()) m.el.attrs = { ...m.before };
    return this.region;
  }
}
