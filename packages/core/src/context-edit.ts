/**
 * Context editing: change or add clef / key signature / meter.
 *
 * MEI semantics, matching what the resolver reads:
 *  - at measure 0, the INITIAL <scoreDef>/<staffDef> attributes are edited
 *    (conflicting child elements like <keySig> are removed — attributes win);
 *  - mid-piece, an interleaved <scoreDef> (keysig/meter, score-wide) or
 *    <staffDef n> (clef, staff-local) is inserted before the measure, or
 *    MERGED into one already sitting there (changes never stack up).
 *
 * Meter changes can invalidate existing music, so planContextChange
 * validates the affected range (up to the next meter change) against the
 * new capacity and refuses loudly, naming the first offender. Whole-measure
 * rests always fit, so preparing empty sections works freely.
 */
import { CoreElement, childElements } from "./xml.js";
import { CoreScore, refreshScore } from "./score.js";
import { MeasureContext } from "./context.js";
import { Command, CommandContext, DirtyRegion } from "./commands.js";
import { validateMeasureDurations } from "./durations.js";
import { ensureIds } from "./ids.js";

export interface ClefSpec {
  shape: string;
  line: number;
  dis?: number;
  disPlace?: "above" | "below";
}

export interface ContextChangeSpec {
  keysig?: string;
  meter?: { count: string; unit: string };
  /** Clef change; applies to staffN (required with clef). */
  clef?: ClefSpec;
  staffN?: number;
}

export type ContextPlan = { ok: true } | { ok: false; reason: string };

/** Validate a context change (only meters can be refused). */
export function planContextChange(score: CoreScore, contexts: MeasureContext[], measureIndex: number, spec: ContextChangeSpec): ContextPlan {
  if (measureIndex < 0 || measureIndex >= score.measures.length) return { ok: false, reason: "no measure at the caret" };
  if (spec.clef && spec.staffN === undefined) return { ok: false, reason: "clef changes need a target staff" };
  if (!spec.keysig && !spec.meter && !spec.clef) return { ok: false, reason: "nothing to change" };
  if (spec.meter) {
    const startMeter = contexts[measureIndex]?.values().next().value?.meter;
    for (let m = measureIndex; m < score.measures.length; m++) {
      const meterHere = contexts[m]?.values().next().value?.meter;
      // A later meter change ends the affected range.
      if (m > measureIndex && meterHere && startMeter && (meterHere.count !== startMeter.count || meterHere.unit !== startMeter.unit || meterHere.sym !== startMeter.sym)) break;
      const problems = validateMeasureDurations(score.measures[m]!, { count: spec.meter.count, unit: spec.meter.unit });
      if (problems.length > 0) {
        return { ok: false, reason: `existing content in m${m + 1} does not fit ${spec.meter.count}/${spec.meter.unit} — adjust it first` };
      }
    }
  }
  return { ok: true };
}

interface AttrMemento {
  el: CoreElement;
  before: Record<string, string>;
}
interface RemovedChild {
  parent: CoreElement;
  at: number;
  el: CoreElement;
}
interface InsertedDef {
  parent: CoreElement;
  el: CoreElement;
}

const CLEF_ATTRS = ["clef.shape", "clef.line", "clef.dis", "clef.dis.place"];

function setClefAttrs(el: CoreElement, clef: ClefSpec): void {
  for (const a of CLEF_ATTRS) delete el.attrs[a];
  el.attrs["clef.shape"] = clef.shape;
  el.attrs["clef.line"] = String(clef.line);
  if (clef.dis) el.attrs["clef.dis"] = String(clef.dis);
  if (clef.disPlace) el.attrs["clef.dis.place"] = clef.disPlace;
}

export class ChangeContextCommand implements Command {
  readonly label: string;
  private attrMementos: AttrMemento[] = [];
  private removedChildren: RemovedChild[] = [];
  private insertedDefs: InsertedDef[] = [];

  constructor(
    private readonly measureIndex: number,
    private readonly spec: ContextChangeSpec,
  ) {
    const parts = [spec.clef && "clef", spec.keysig !== undefined && "key", spec.meter && "meter"].filter(Boolean);
    this.label = `change ${parts.join("+")} at m${measureIndex + 1}`;
  }

  private touchAttrs(el: CoreElement): void {
    this.attrMementos.push({ el, before: { ...el.attrs } });
  }

  private removeChildren(el: CoreElement, tags: Set<string>): void {
    for (let i = el.children.length - 1; i >= 0; i--) {
      const c = el.children[i];
      if (c === undefined || typeof c === "string" || !tags.has(c.tag)) continue;
      this.removedChildren.push({ parent: el, at: i, el: c });
      el.children.splice(i, 1);
    }
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    this.attrMementos = [];
    this.removedChildren = [];
    this.insertedDefs = [];
    const { spec } = this;
    const measure = ctx.score.measures[this.measureIndex];
    if (!measure) throw new Error("no measure at the target");

    if (this.measureIndex === 0) {
      // Edit the initial definitions in place.
      if (spec.keysig !== undefined || spec.meter) {
        const scoreDef = ctx.score.scoreDef;
        this.touchAttrs(scoreDef);
        if (spec.keysig !== undefined) {
          delete scoreDef.attrs["key.sig"];
          scoreDef.attrs["keysig"] = spec.keysig;
          this.removeChildren(scoreDef, new Set(["keySig"]));
        }
        if (spec.meter) {
          delete scoreDef.attrs["meter.sym"];
          scoreDef.attrs["meter.count"] = spec.meter.count;
          scoreDef.attrs["meter.unit"] = spec.meter.unit;
          this.removeChildren(scoreDef, new Set(["meterSig", "meterSigGrp"]));
        }
        // Per-staff overrides in the initial defs would defeat the change.
        for (const sd of childElements(ctx.score.scoreDef).flatMap(function walk(e): CoreElement[] {
          return e.tag === "staffDef" ? [e] : childElements(e).flatMap(walk);
        })) {
          this.touchAttrs(sd);
          if (spec.keysig !== undefined) {
            delete sd.attrs["keysig"];
            delete sd.attrs["key.sig"];
            this.removeChildren(sd, new Set(["keySig"]));
          }
          if (spec.meter) {
            delete sd.attrs["meter.count"];
            delete sd.attrs["meter.unit"];
            delete sd.attrs["meter.sym"];
            this.removeChildren(sd, new Set(["meterSig", "meterSigGrp"]));
          }
        }
      }
      if (spec.clef) {
        const staffDef = childElements(ctx.score.scoreDef)
          .flatMap(function walk(e): CoreElement[] {
            return e.tag === "staffDef" ? [e] : childElements(e).flatMap(walk);
          })
          .find((sd) => Number(sd.attrs["n"] ?? "1") === spec.staffN);
        if (!staffDef) throw new Error(`no staff ${spec.staffN} in the score definitions`);
        this.touchAttrs(staffDef);
        setClefAttrs(staffDef, spec.clef);
        this.removeChildren(staffDef, new Set(["clef"]));
      }
    } else {
      const parent = ctx.score.measureParent.get(measure);
      if (!parent) throw new Error("measure parent not found");
      const at = parent.children.indexOf(measure);
      // Merge into defs already sitting directly before this measure.
      const preceding: CoreElement[] = [];
      for (let i = at - 1; i >= 0; i--) {
        const c = parent.children[i];
        if (c === undefined || typeof c === "string") continue;
        if (c.tag === "scoreDef" || c.tag === "staffDef") preceding.push(c);
        else break;
      }
      if (spec.keysig !== undefined || spec.meter) {
        let scoreDef = preceding.find((d) => d.tag === "scoreDef");
        if (scoreDef) this.touchAttrs(scoreDef);
        else {
          scoreDef = { tag: "scoreDef", attrs: {}, children: [] };
          ensureIds(scoreDef);
          parent.children.splice(at, 0, scoreDef);
          this.insertedDefs.push({ parent, el: scoreDef });
        }
        if (spec.keysig !== undefined) scoreDef.attrs["keysig"] = spec.keysig;
        if (spec.meter) {
          delete scoreDef.attrs["meter.sym"];
          scoreDef.attrs["meter.count"] = spec.meter.count;
          scoreDef.attrs["meter.unit"] = spec.meter.unit;
        }
      }
      if (spec.clef) {
        let staffDef = preceding.find((d) => d.tag === "staffDef" && Number(d.attrs["n"] ?? "1") === spec.staffN);
        if (staffDef) this.touchAttrs(staffDef);
        else {
          staffDef = { tag: "staffDef", attrs: { n: String(spec.staffN) }, children: [] };
          ensureIds(staffDef);
          const measureAt = parent.children.indexOf(measure);
          parent.children.splice(measureAt, 0, staffDef);
          this.insertedDefs.push({ parent, el: staffDef });
        }
        setClefAttrs(staffDef, spec.clef);
      }
    }
    // Inserted defs must enter the score's item walk for the resolver.
    if (this.insertedDefs.length) refreshScore(ctx.score);
    // Context propagates to everything downstream.
    return ctx.score.measures.slice(this.measureIndex).map((_, i) => ({ measureIndex: this.measureIndex + i, staffN: this.spec.staffN ?? 0 }));
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    for (const d of this.insertedDefs) {
      const i = d.parent.children.indexOf(d.el);
      if (i >= 0) d.parent.children.splice(i, 1);
    }
    // Restore in reverse: children back first (indices), then attributes.
    for (const r of [...this.removedChildren].reverse()) r.parent.children.splice(r.at, 0, r.el);
    for (const m of [...this.attrMementos].reverse()) m.el.attrs = { ...m.before };
    if (this.insertedDefs.length) refreshScore(ctx.score);
    return ctx.score.measures.slice(this.measureIndex).map((_, i) => ({ measureIndex: this.measureIndex + i, staffN: this.spec.staffN ?? 0 }));
  }
}
