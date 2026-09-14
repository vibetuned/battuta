/**
 * Pitch content as data, and the one command that writes it.
 *
 * This is the DOCUMENT half of what used to be `reflect.ts`: reading the
 * pitched events out of a block, and writing pitch triples back onto
 * them as one undoable step. It knows what a pitch is and how MEI spells
 * one; it has no opinion about what a caller means by the change.
 *
 * The FEATURE half — the serial forms of the reflection cycle — left for
 * `@battuta/plugin-reflection` in slice 2: those functions have no MEI
 * knowledge and exist only because that feature does, and core ships
 * inside the host's initial chunk, so keeping them here would have cost
 * every user their weight at launch whether or not they ever press the
 * key. Anything here, by contrast, is what any pitch feature needs.
 */
import { CoreElement } from "./xml.js";
import { Command, CommandContext, DirtyRegion, targetNotes } from "./commands.js";
import { CoreScore } from "./score.js";
import { EventIndex } from "./events.js";

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

/**
 * Write pitch content onto events (notes in child order for chords).
 * Full-attribute mementos, so a revert restores attributes this command
 * never touched and is byte-identical rather than merely equivalent.
 *
 * Sharp edge: `apply` throws when a target's pitch count does not match
 * the event's note count, and it throws AFTER writing earlier targets —
 * a half-applied command that never reaches the undo stack. Build
 * targets from the document you are about to write to (which is what
 * every caller does) and arity matches by construction.
 */
export class SetPitchesCommand implements Command {
  readonly label: string;
  private mementos: { el: CoreElement; before: Record<string, string> }[] = [];
  private region: DirtyRegion[] = [];

  constructor(
    private readonly targets: PitchEvent[],
    label = "set pitches",
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
