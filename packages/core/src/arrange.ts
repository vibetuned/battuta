/**
 * Arranging commands: block paste (replace-measures policy) and structural
 * measure operations. Every paste is validated against the duration
 * invariant BEFORE a command is created — planPasteReplace returns a typed
 * verdict so the UI can explain refusals; the command itself is mechanical.
 */
import { CoreElement, childElements, deepClone } from "./xml.js";
import { CoreScore, refreshScore } from "./score.js";
import { MeasureContext } from "./context.js";
import { Command, CommandContext, DirtyRegion } from "./commands.js";
import { ClipboardFragment, findStaffInMeasure, materializeStaff } from "./clipboard.js";
import { layerDuration, meterCapacity, fEq } from "./durations.js";
import { ensureIds } from "./ids.js";

/* ------------------------------------------------------------------ */
/* Paste planning (validation)                                         */

export type PastePlan =
  | { ok: true; warnings: string[] }
  | { ok: false; reason: string };

/**
 * Validate a replace-measures paste of `frag` at (measureIndex, staffN).
 * Refusals: block exceeds the score or staff range; a pasted layer's
 * duration does not fill the target measure under the TARGET meter.
 * Warnings (allowed, surfaced to the user): meter notation differs but
 * capacities match; key signature differs (written-pitch paste).
 */
export function planPasteReplace(score: CoreScore, contexts: MeasureContext[], frag: ClipboardFragment, measureIndex: number, staffN: number): PastePlan {
  if (measureIndex < 0 || measureIndex + frag.measureCount > score.measures.length) {
    return { ok: false, reason: `block of ${frag.measureCount} measure(s) does not fit at measure ${measureIndex + 1} (score has ${score.measures.length})` };
  }
  const warnings: string[] = [];
  for (let k = 0; k < frag.measureCount; k++) {
    const ctx = contexts[measureIndex + k];
    if (!ctx) return { ok: false, reason: `no context for measure ${measureIndex + k + 1}` };
    for (let si = 0; si < frag.staves.length; si++) {
      const targetN = staffN + si;
      const staffCtx = ctx.get(targetN);
      if (!staffCtx) return { ok: false, reason: `staff ${targetN} does not exist at measure ${measureIndex + k + 1}` };
      const capacity = meterCapacity(staffCtx.meter);
      const staffEl = frag.staves[si]!.measures[k];
      if (!capacity || !staffEl) continue;
      for (const layer of childElements(staffEl).filter((c) => c.tag === "layer")) {
        const d = layerDuration(layer);
        if (d.fillsMeasure || d.unresolved > 0) continue;
        if (!fEq(d.total, capacity)) {
          return {
            ok: false,
            reason: `duration mismatch at measure ${measureIndex + k + 1}, staff ${targetN}: layer sums ${d.total.num}/${d.total.den}, target measure holds ${capacity.num}/${capacity.den}`,
          };
        }
      }
    }
  }
  const first = contexts[measureIndex]!.get(staffN);
  if (first) {
    const tc = meterCapacity(first.meter);
    const fc = meterCapacity(frag.meter);
    if (tc && fc && (first.meter.count !== frag.meter.count || first.meter.unit !== frag.meter.unit)) {
      warnings.push(`meter notation differs (source ${frag.meter.count ?? "?"}/${frag.meter.unit ?? "?"} → target ${first.meter.count ?? "?"}/${first.meter.unit ?? "?"})`);
    }
    const fragKeysig = frag.staves[0]?.keysig;
    if (fragKeysig !== undefined && fragKeysig !== first.keysig) {
      warnings.push(`key signature differs (source ${fragKeysig} → target ${first.keysig}); pasting written pitches`);
    }
  }
  return { ok: true, warnings };
}

/* ------------------------------------------------------------------ */
/* Replace-measures paste                                              */

interface StaffMemento {
  measureEl: CoreElement;
  at: number;
  original: CoreElement | null; // null = staff slot did not exist (was inserted)
  inserted: CoreElement;
  measureIndex: number;
  staffN: number;
}

export class PasteReplaceMeasuresCommand implements Command {
  readonly label: string;
  private mementos: StaffMemento[] = [];

  constructor(
    private readonly frag: ClipboardFragment,
    private readonly measureIndex: number,
    private readonly staffN: number,
  ) {
    this.label = `paste ${frag.measureCount}×${frag.staves.length} block at m${measureIndex + 1}/staff ${staffN}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    this.mementos = [];
    for (let k = 0; k < this.frag.measureCount; k++) {
      const measureEl = ctx.score.measures[this.measureIndex + k];
      if (!measureEl) break;
      for (let si = 0; si < this.frag.staves.length; si++) {
        const targetN = this.staffN + si;
        const source = this.frag.staves[si]!.measures[k];
        if (!source) continue;
        const fresh = materializeStaff(source);
        fresh.attrs["n"] = String(targetN);
        const existing = findStaffInMeasure(measureEl, targetN);
        if (existing) {
          const at = measureEl.children.indexOf(existing);
          measureEl.children[at] = fresh;
          this.mementos.push({ measureEl, at, original: existing, inserted: fresh, measureIndex: this.measureIndex + k, staffN: targetN });
        } else {
          // Insert keeping <staff> elements ordered by @n.
          const staves = childElements(measureEl).filter((c) => c.tag === "staff");
          const after = staves.filter((s) => Number(s.attrs["n"] ?? "1") < targetN).pop();
          const at = after ? measureEl.children.indexOf(after) + 1 : measureEl.children.findIndex((c) => typeof c !== "string" && c.tag === "staff");
          const insertAt = at < 0 ? measureEl.children.length : at;
          measureEl.children.splice(insertAt, 0, fresh);
          this.mementos.push({ measureEl, at: insertAt, original: null, inserted: fresh, measureIndex: this.measureIndex + k, staffN: targetN });
        }
      }
    }
    return this.mementos.map((m) => ({ measureIndex: m.measureIndex, staffN: m.staffN }));
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    for (const m of [...this.mementos].reverse()) {
      if (m.original) m.measureEl.children[m.at] = m.original;
      else m.measureEl.children.splice(m.at, 1);
    }
    return this.mementos.map((m) => ({ measureIndex: m.measureIndex, staffN: m.staffN }));
  }
}

/* ------------------------------------------------------------------ */
/* Structural measure commands                                         */

interface RemovedMeasure {
  el: CoreElement;
  parent: CoreElement;
  at: number;
}

function removeMeasures(score: CoreScore, from: number, count: number): RemovedMeasure[] {
  const removed: RemovedMeasure[] = [];
  // Collect first (indices shift as we splice), then remove back-to-front.
  const targets = score.measures.slice(from, from + count);
  for (const el of [...targets].reverse()) {
    const parent = score.measureParent.get(el);
    if (!parent) continue;
    const at = parent.children.indexOf(el);
    parent.children.splice(at, 1);
    removed.unshift({ el, parent, at });
  }
  refreshScore(score);
  return removed;
}

function insertMeasuresAt(score: CoreScore, at: number, els: CoreElement[]): void {
  const anchor = score.measures[at] ?? null;
  if (anchor) {
    const parent = score.measureParent.get(anchor)!;
    parent.children.splice(parent.children.indexOf(anchor), 0, ...els);
  } else {
    const last = score.measures[score.measures.length - 1];
    if (!last) throw new Error("cannot insert into an empty score");
    const parent = score.measureParent.get(last)!;
    parent.children.splice(parent.children.indexOf(last) + 1, 0, ...els);
  }
  refreshScore(score);
}

/** Synthesize an empty measure matching a template's staff/layer shape. */
export function emptyMeasureLike(template: CoreElement): CoreElement {
  const measure: CoreElement = { tag: "measure", attrs: { n: template.attrs["n"] ? `${template.attrs["n"]}a` : "" }, children: [] };
  for (const staff of childElements(template).filter((c) => c.tag === "staff")) {
    measure.children.push({
      tag: "staff",
      attrs: { n: staff.attrs["n"] ?? "1" },
      children: [{ tag: "layer", attrs: { n: "1" }, children: [{ tag: "mRest", attrs: {}, children: [] }] }],
    });
  }
  ensureIds(measure);
  return measure;
}

export class InsertMeasuresCommand implements Command {
  readonly label: string;
  private inserted: CoreElement[] = [];

  constructor(
    private readonly at: number,
    private readonly count: number,
  ) {
    this.label = `insert ${count} measure(s) at m${at + 1}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const template = ctx.score.measures[Math.min(this.at, ctx.score.measures.length - 1)];
    if (!template) return [];
    this.inserted = Array.from({ length: this.count }, () => emptyMeasureLike(template));
    insertMeasuresAt(ctx.score, this.at, this.inserted);
    return this.dirtyFrom(ctx);
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    for (const el of this.inserted) {
      const parent = ctx.score.measureParent.get(el);
      if (parent) parent.children.splice(parent.children.indexOf(el), 1);
    }
    refreshScore(ctx.score);
    return this.dirtyFrom(ctx);
  }

  private dirtyFrom(ctx: CommandContext): DirtyRegion[] {
    // Everything from the insertion point shifts.
    return ctx.score.measures.slice(this.at).map((_, i) => ({ measureIndex: this.at + i, staffN: 0 }));
  }
}

export class DeleteMeasuresCommand implements Command {
  readonly label: string;
  private removed: RemovedMeasure[] = [];

  constructor(
    private readonly at: number,
    private readonly count: number,
  ) {
    this.label = `delete ${count} measure(s) at m${at + 1}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    this.removed = removeMeasures(ctx.score, this.at, this.count);
    return ctx.score.measures.slice(this.at).map((_, i) => ({ measureIndex: this.at + i, staffN: 0 }));
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    for (const r of this.removed) r.parent.children.splice(r.at, 0, r.el);
    refreshScore(ctx.score);
    return ctx.score.measures.slice(this.at).map((_, i) => ({ measureIndex: this.at + i, staffN: 0 }));
  }
}

export class DuplicateMeasuresCommand implements Command {
  readonly label: string;
  private inserted: CoreElement[] = [];

  constructor(
    private readonly at: number,
    private readonly count: number,
  ) {
    this.label = `duplicate ${count} measure(s) at m${at + 1}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const originals = ctx.score.measures.slice(this.at, this.at + this.count);
    this.inserted = originals.map((m) => {
      const clone = deepClone(m);
      const strip = (e: CoreElement): void => {
        delete e.attrs["xml:id"];
        for (const c of childElements(e)) strip(c);
      };
      strip(clone);
      ensureIds(clone);
      return clone;
    });
    insertMeasuresAt(ctx.score, this.at + this.count, this.inserted);
    return ctx.score.measures.slice(this.at).map((_, i) => ({ measureIndex: this.at + i, staffN: 0 }));
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    for (const el of this.inserted) {
      const parent = ctx.score.measureParent.get(el);
      if (parent) parent.children.splice(parent.children.indexOf(el), 1);
    }
    refreshScore(ctx.score);
    return ctx.score.measures.slice(this.at).map((_, i) => ({ measureIndex: this.at + i, staffN: 0 }));
  }
}
