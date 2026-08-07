/**
 * Beaming policy: beams are FORMATTING, owned by the editor.
 *  - AutoBeamCommand groups a measure's beamable notes (eighth and shorter)
 *    into <beam> wrappers whose longest span is HALF the measure regardless
 *    of meter (onset decides the half); rests and longer notes break groups;
 *    runs shorter than two stay unbeamed. Existing beams are lifted first,
 *    so the command is idempotent and doubles as "rebeam".
 *  - UnbeamMeasuresCommand lifts every beam in the given measures. The
 *    session runs it in front of rhythm edits (UnbeamThen) so overwrite
 *    entry never fights beam boundaries and no broken beams survive an
 *    edit — re-beam with alt+b when the rhythm settles.
 * Event ids never change: beams only wrap/unwrap, so the caret, selection,
 * and the event index (which walks through beams) are unaffected.
 */
import { CoreElement, childElements } from "./xml.js";
import { CoreScore } from "./score.js";
import { resolveContexts } from "./context.js";
import { Command, CommandContext, DirtyRegion } from "./commands.js";
import { Fraction, F0, fAdd, fMul, fCmp, frac, eventDuration, meterCapacity } from "./durations.js";
import { newId } from "./ids.js";

interface BeamSlot {
  parent: CoreElement;
  at: number;
  beam: CoreElement;
}

/** Duration of one layer child, tuplet scale applied (containers sum). */
function elementSpan(el: CoreElement, scale: Fraction): Fraction {
  if (el.tag === "tuplet") {
    const num = Number(el.attrs["num"] ?? "3");
    const numbase = Number(el.attrs["numbase"] ?? "2");
    scale = fMul(scale, frac(numbase, num));
  }
  if (el.tag === "note" || el.tag === "chord" || el.tag === "rest" || el.tag === "space") {
    return fMul(eventDuration(el) ?? F0, scale);
  }
  let total = F0;
  for (const c of childElements(el)) total = fAdd(total, elementSpan(c, scale));
  return total;
}

const beamable = (el: CoreElement): boolean =>
  (el.tag === "note" || el.tag === "chord") && !el.attrs["grace"] && Number(el.attrs["dur"] ?? "0") >= 8;

/** Lift every <beam> under el (beams inside tuplets included), inner-first. */
function liftBeams(el: CoreElement, out: BeamSlot[]): void {
  for (let i = 0; i < el.children.length; i++) {
    const c = el.children[i];
    if (c === undefined || typeof c === "string") continue;
    liftBeams(c, out);
    if (c.tag === "beam") {
      el.children.splice(i, 1, ...c.children);
      out.push({ parent: el, at: i, beam: c });
      i += c.children.length - 1;
    }
  }
}

/**
 * Wrap half-measure runs in fresh beams. Two passes per container: plan the
 * runs against stable indices, then wrap back-to-front so earlier indices
 * stay valid (revert unwraps in exact reverse mutation order).
 */
function beamContainer(container: CoreElement, onset: { v: Fraction }, scale: Fraction, half: Fraction, created: BeamSlot[]): void {
  const runs: { at: number; len: number }[] = [];
  let run = { at: -1, len: 0, half: -1 };
  const flush = () => {
    if (run.len >= 2) runs.push({ at: run.at, len: run.len });
    run = { at: -1, len: 0, half: -1 };
  };
  for (let i = 0; i < container.children.length; i++) {
    const c = container.children[i];
    if (c === undefined || typeof c === "string") continue;
    if (c.tag === "tuplet") {
      flush();
      const num = Number(c.attrs["num"] ?? "3");
      const numbase = Number(c.attrs["numbase"] ?? "2");
      beamContainer(c, onset, fMul(scale, frac(numbase, num)), half, created);
      continue;
    }
    const span = elementSpan(c, scale);
    if (beamable(c)) {
      const halfIndex = fCmp(onset.v, half) < 0 ? 0 : 1;
      if (run.len && halfIndex !== run.half) flush();
      if (!run.len) {
        run.at = i;
        run.half = halfIndex;
      }
      run.len++;
    } else {
      flush();
    }
    onset.v = fAdd(onset.v, span);
  }
  flush();
  for (const r of [...runs].reverse()) {
    const children = container.children.slice(r.at, r.at + r.len) as CoreElement[];
    const beam: CoreElement = { tag: "beam", attrs: { "xml:id": newId() }, children };
    container.children.splice(r.at, r.len, beam);
    created.push({ parent: container, at: r.at, beam });
  }
}

/** Lift every beam in the given measures (the "edits break beams" half). */
export class UnbeamMeasuresCommand implements Command {
  readonly label = "unbeam";
  private lifted: BeamSlot[] = [];

  constructor(private readonly measureIndexes: number[]) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    this.lifted = [];
    const out: DirtyRegion[] = [];
    for (const m of this.measureIndexes) {
      const measure = ctx.score.measures[m];
      if (!measure) continue;
      const before = this.lifted.length;
      for (const staff of childElements(measure).filter((c) => c.tag === "staff")) liftBeams(staff, this.lifted);
      if (this.lifted.length > before) out.push({ measureIndex: m, staffN: 0 });
    }
    return out;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    for (const s of [...this.lifted].reverse()) s.parent.children.splice(s.at, s.beam.children.length, s.beam);
    return this.measureIndexes.map((m) => ({ measureIndex: m, staffN: 0 }));
  }
}

/** Re-beam whole measures: lift everything, then group by half-measure. */
export class AutoBeamCommand implements Command {
  readonly label = "auto-beam";
  private lifted: BeamSlot[] = [];
  private created: BeamSlot[] = [];

  constructor(private readonly measureIndexes: number[]) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    this.lifted = [];
    this.created = [];
    const contexts = resolveContexts(ctx.score);
    for (const m of this.measureIndexes) {
      const measure = ctx.score.measures[m];
      if (!measure) continue;
      for (const staff of childElements(measure).filter((c) => c.tag === "staff")) {
        const staffN = Number(staff.attrs["n"] ?? "1");
        const capacity = meterCapacity(contexts[m]?.get(staffN)?.meter ?? {});
        if (!capacity) continue; // free meter: nothing sensible to group by
        const half = fMul(capacity, frac(1, 2));
        for (const layer of childElements(staff).filter((c) => c.tag === "layer")) {
          liftBeams(layer, this.lifted);
          beamContainer(layer, { v: F0 }, frac(1, 1), half, this.created);
        }
      }
    }
    return this.measureIndexes.map((m) => ({ measureIndex: m, staffN: 0 }));
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    for (const s of [...this.created].reverse()) s.parent.children.splice(s.at, 1, ...s.beam.children);
    for (const s of [...this.lifted].reverse()) s.parent.children.splice(s.at, s.beam.children.length, s.beam);
    return this.measureIndexes.map((m) => ({ measureIndex: m, staffN: 0 }));
  }
}

/**
 * Session policy wrapper: unbeam the touched measures FIRST, then run the
 * rhythm edit — so overwrite entry can consume across former beam
 * boundaries, and no half-broken beams survive. One undo step.
 */
export class UnbeamThen implements Command {
  readonly label: string;
  private readonly unbeam: UnbeamMeasuresCommand;

  constructor(
    readonly inner: Command,
    measureIndexes: number[],
  ) {
    this.label = inner.label;
    this.unbeam = new UnbeamMeasuresCommand(measureIndexes);
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const r1 = this.unbeam.apply(ctx);
    try {
      const r2 = this.inner.apply(ctx);
      return [...r2, ...r1];
    } catch (e) {
      this.unbeam.revert(ctx);
      throw e;
    }
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    const r2 = this.inner.revert(ctx);
    const r1 = this.unbeam.revert(ctx);
    return [...r2, ...r1];
  }
}

/** Measures a set of event ids lives in (for the session's unbeam wrap). */
export function measuresOf(score: CoreScore, index: { byId: Map<string, { measureIndex: number }> }, ids: string[]): number[] {
  const out = new Set<number>();
  for (const id of ids) {
    const ref = index.byId.get(id);
    if (ref && ref.measureIndex < score.measures.length) out.add(ref.measureIndex);
  }
  return [...out];
}
