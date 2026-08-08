/**
 * Arranging commands: block paste (replace-measures policy) and structural
 * measure operations. Every paste is validated against the duration
 * invariant BEFORE a command is created — planPasteReplace returns a typed
 * verdict so the UI can explain refusals; the command itself is mechanical.
 */
import { CoreElement, childElements, deepClone, findAll } from "./xml.js";
import { CoreScore, refreshScore } from "./score.js";
import { MeasureContext } from "./context.js";
import { Command, CommandContext, DirtyRegion } from "./commands.js";
import { ClipboardFragment, findStaffInMeasure, materializeStaff, controlRefs } from "./clipboard.js";
import { layerDuration, meterCapacity, fEq } from "./durations.js";
import { ensureIds, newId } from "./ids.js";

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
  /** Control events removed because their anchors were replaced. */
  private removedControls: { measure: CoreElement; at: number; el: CoreElement }[] = [];
  /** Control events recreated from the fragment (anchors remapped). */
  private insertedControls: { measure: CoreElement; el: CoreElement }[] = [];
  private renumbered: NumberMemento = null;

  constructor(
    private readonly frag: ClipboardFragment,
    private readonly measureIndex: number,
    private readonly staffN: number,
  ) {
    this.label = `paste ${frag.measureCount}×${frag.staves.length} block at m${measureIndex + 1}/staff ${staffN}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    this.mementos = [];
    this.removedControls = [];
    this.insertedControls = [];
    const idMap = new Map<string, string>();
    const replacedIds = new Set<string>();
    const collectIds = (e: CoreElement): void => {
      const id = e.attrs["xml:id"];
      if (id) replacedIds.add(id);
      for (const c of childElements(e)) collectIds(c);
    };
    for (let k = 0; k < this.frag.measureCount; k++) {
      const measureEl = ctx.score.measures[this.measureIndex + k];
      if (!measureEl) break;
      for (let si = 0; si < this.frag.staves.length; si++) {
        const targetN = this.staffN + si;
        const source = this.frag.staves[si]!.measures[k];
        if (!source) continue;
        const fresh = materializeStaff(source, idMap);
        fresh.attrs["n"] = String(targetN);
        const existing = findStaffInMeasure(measureEl, targetN);
        if (existing) collectIds(existing);
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
    // Drop control events whose anchors were just replaced (dead startids),
    // then recreate the fragment's own controls with remapped anchors.
    for (let k = 0; k < this.frag.measureCount; k++) {
      const measureEl = ctx.score.measures[this.measureIndex + k];
      if (!measureEl) break;
      for (let i = measureEl.children.length - 1; i >= 0; i--) {
        const c = measureEl.children[i];
        if (c === undefined || typeof c === "string" || c.tag === "staff") continue;
        const refs = controlRefs(c);
        if (refs.length && refs.some((r) => replacedIds.has(r))) {
          measureEl.children.splice(i, 1);
          this.removedControls.push({ measure: measureEl, at: i, el: c });
        }
      }
    }
    for (const ctl of this.frag.controls ?? []) {
      const measureEl = ctx.score.measures[this.measureIndex + ctl.atMeasure];
      if (!measureEl) continue;
      const refs = controlRefs(ctl.el);
      if (!refs.every((r) => idMap.has(r))) continue; // anchor not pasted (staff outside target range)
      const el = deepClone(ctl.el);
      el.attrs["xml:id"] = newId();
      for (const a of ["startid", "endid"]) {
        const ref = el.attrs[a] ? el.attrs[a]!.replace(/^#/, "") : undefined;
        if (ref) el.attrs[a] = `#${idMap.get(ref)!}`;
      }
      if (el.attrs["staff"] !== undefined) el.attrs["staff"] = String(this.staffN + ctl.staffOffset);
      measureEl.children.push(el);
      this.insertedControls.push({ measure: measureEl, el });
    }
    // Pasted spans (slur/hairpin) must reach the tile span-end index.
    refreshScore(ctx.score);
    // Normalize measure numbering too — pasting into a document with stale
    // @n (older saves) should leave it sequential like the structural ops.
    this.renumbered = renumberMeasures(ctx.score, numberingAnchor(ctx.score));
    return this.mementos.map((m) => ({ measureIndex: m.measureIndex, staffN: m.staffN }));
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    restoreNumbers(this.renumbered);
    for (const ic of [...this.insertedControls].reverse()) {
      const i = ic.measure.children.indexOf(ic.el);
      if (i >= 0) ic.measure.children.splice(i, 1);
    }
    for (const rc of [...this.removedControls].reverse()) rc.measure.children.splice(rc.at, 0, rc.el);
    for (const m of [...this.mementos].reverse()) {
      if (m.original) m.measureEl.children[m.at] = m.original;
      else m.measureEl.children.splice(m.at, 1);
    }
    refreshScore(ctx.score);
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
    let i = parent.children.indexOf(anchor);
    // Interleaved defs bind to the measure they precede: new measures go
    // BEFORE them, staying in the PREVIOUS measure's context — a duplicate
    // must keep its source's meter, not adopt the next section's.
    while (i > 0) {
      const prev = parent.children[i - 1];
      if (prev === undefined || typeof prev === "string" || (prev.tag !== "scoreDef" && prev.tag !== "staffDef")) break;
      i--;
    }
    parent.children.splice(i, 0, ...els);
  } else {
    const last = score.measures[score.measures.length - 1];
    if (!last) throw new Error("cannot insert into an empty score");
    const parent = score.measureParent.get(last)!;
    parent.children.splice(parent.children.indexOf(last) + 1, 0, ...els);
  }
  refreshScore(score);
}

type NumberMemento = { el: CoreElement; n: string | undefined }[] | null;

/** Pre-op numbering anchor: capture before mutating (see renumberMeasures). */
function numberingAnchor(score: CoreScore): { el: CoreElement | undefined; n: string | undefined } {
  const el = score.measures[0];
  return { el, n: el?.attrs["n"] };
}

/**
 * Sequential @n after structural changes — Verovio prints @n at system
 * starts, and template-suffix names compound into "4aaaa" otherwise.
 * The base comes from the PRE-op first measure: a surviving pickup keeps
 * its 0-based numbering, but deleting the head restarts at 1. Non-numeric
 * editorial numbering is left alone entirely.
 */
function renumberMeasures(score: CoreScore, anchor: { el: CoreElement | undefined; n: string | undefined }): NumberMemento {
  if (anchor.n !== undefined && anchor.n !== "" && !/^\d+$/.test(anchor.n)) return null;
  const base = anchor.el === score.measures[0] && anchor.n && /^\d+$/.test(anchor.n) ? Number(anchor.n) : 1;
  const memo = score.measures.map((el) => ({ el, n: el.attrs["n"] }));
  score.measures.forEach((el, i) => {
    el.attrs["n"] = String(base + i);
  });
  return memo;
}

function restoreNumbers(memo: NumberMemento): void {
  if (!memo) return;
  for (const { el, n } of memo) {
    if (n === undefined) delete el.attrs["n"];
    else el.attrs["n"] = n;
  }
}

/** Synthesize an empty measure matching a template's staff AND voice shape
 * (every layer of every staff comes back as a whole-measure rest). */
export function emptyMeasureLike(template: CoreElement): CoreElement {
  const measure: CoreElement = { tag: "measure", attrs: { n: template.attrs["n"] ? `${template.attrs["n"]}a` : "" }, children: [] };
  for (const staff of childElements(template).filter((c) => c.tag === "staff")) {
    const layers = childElements(staff).filter((c) => c.tag === "layer");
    measure.children.push({
      tag: "staff",
      attrs: { n: staff.attrs["n"] ?? "1" },
      children: (layers.length ? layers : [null]).map((l) => ({
        tag: "layer",
        attrs: { n: l?.attrs["n"] ?? "1" },
        children: [{ tag: "mRest", attrs: {}, children: [] }],
      })),
    });
  }
  ensureIds(measure);
  return measure;
}

export class InsertMeasuresCommand implements Command {
  readonly label: string;
  private inserted: CoreElement[] = [];
  private renumbered: NumberMemento = null;

  constructor(
    private readonly at: number,
    private readonly count: number,
  ) {
    this.label = `insert ${count} measure(s) at m${at + 1}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const template = ctx.score.measures[Math.min(this.at, ctx.score.measures.length - 1)];
    if (!template) return [];
    const anchor = numberingAnchor(ctx.score);
    this.inserted = Array.from({ length: this.count }, () => emptyMeasureLike(template));
    insertMeasuresAt(ctx.score, this.at, this.inserted);
    this.renumbered = renumberMeasures(ctx.score, anchor);
    return this.dirtyFrom(ctx);
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    restoreNumbers(this.renumbered);
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
  private renumbered: NumberMemento = null;

  constructor(
    private readonly at: number,
    private readonly count: number,
  ) {
    this.label = `delete ${count} measure(s) at m${at + 1}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const anchor = numberingAnchor(ctx.score);
    this.removed = removeMeasures(ctx.score, this.at, this.count);
    this.renumbered = renumberMeasures(ctx.score, anchor);
    return ctx.score.measures.slice(this.at).map((_, i) => ({ measureIndex: this.at + i, staffN: 0 }));
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    restoreNumbers(this.renumbered);
    for (const r of this.removed) r.parent.children.splice(r.at, 0, r.el);
    refreshScore(ctx.score);
    return ctx.score.measures.slice(this.at).map((_, i) => ({ measureIndex: this.at + i, staffN: 0 }));
  }
}

export class DuplicateMeasuresCommand implements Command {
  readonly label: string;
  private inserted: CoreElement[] = [];
  private renumbered: NumberMemento = null;

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
    const anchor = numberingAnchor(ctx.score);
    insertMeasuresAt(ctx.score, this.at + this.count, this.inserted);
    this.renumbered = renumberMeasures(ctx.score, anchor);
    return ctx.score.measures.slice(this.at).map((_, i) => ({ measureIndex: this.at + i, staffN: 0 }));
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    restoreNumbers(this.renumbered);
    for (const el of this.inserted) {
      const parent = ctx.score.measureParent.get(el);
      if (parent) parent.children.splice(parent.children.indexOf(el), 1);
    }
    refreshScore(ctx.score);
    return ctx.score.measures.slice(this.at).map((_, i) => ({ measureIndex: this.at + i, staffN: 0 }));
  }
}

/* ------------------------------------------------------------------ */

interface RemovedChild {
  parent: CoreElement;
  at: number;
  el: CoreElement;
}

const allDirty = (ctx: CommandContext): DirtyRegion[] => ctx.score.measures.map((_, i) => ({ measureIndex: i, staffN: 0 }));

/**
 * Add a staff below the existing ones: a staffDef (treble, 5 lines) after
 * the last one in the initial defs, and an mRest staff in every measure —
 * duration-invariant under any meter by construction.
 */
export class AddStaffCommand implements Command {
  readonly label = "add staff";
  /** The new staff's number, set by apply (max existing + 1). */
  staffN = 0;
  private added: RemovedChild[] = [];

  apply(ctx: CommandContext): DirtyRegion[] {
    this.added = [];
    const defs = findAll(ctx.score.scoreDef, "staffDef");
    const last = defs[defs.length - 1];
    if (!last) throw new Error("no staff definitions to extend");
    this.staffN = Math.max(...defs.map((d) => Number(d.attrs["n"] ?? "1"))) + 1;
    const def: CoreElement = { tag: "staffDef", attrs: { n: String(this.staffN), lines: "5", "clef.shape": "G", "clef.line": "2" }, children: [] };
    ensureIds(def);
    const grp = (function findParent(el: CoreElement): CoreElement | null {
      for (const c of childElements(el)) {
        if (c === last) return el;
        const hit = findParent(c);
        if (hit) return hit;
      }
      return null;
    })(ctx.score.scoreDef);
    if (!grp) throw new Error("staffDef parent not found");
    const at = grp.children.indexOf(last) + 1;
    grp.children.splice(at, 0, def);
    this.added.push({ parent: grp, at, el: def });
    for (const measure of ctx.score.measures) {
      const staff: CoreElement = {
        tag: "staff",
        attrs: { n: String(this.staffN) },
        children: [{ tag: "layer", attrs: { n: "1" }, children: [{ tag: "mRest", attrs: {}, children: [] }] }],
      };
      ensureIds(staff);
      // After the last staff, before the measure's control events.
      const staves = measure.children.filter((c) => typeof c !== "string" && c.tag === "staff") as CoreElement[];
      const lastStaff = staves[staves.length - 1];
      const staffAt = lastStaff ? measure.children.indexOf(lastStaff) + 1 : 0;
      measure.children.splice(staffAt, 0, staff);
      this.added.push({ parent: measure, at: staffAt, el: staff });
    }
    return allDirty(ctx);
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    for (const a of [...this.added].reverse()) {
      const i = a.parent.children.indexOf(a.el);
      if (i >= 0) a.parent.children.splice(i, 1);
    }
    return allDirty(ctx);
  }
}

/**
 * Remove one staff everywhere: its initial staffDef, interleaved staffDefs,
 * the staff element in every measure, and control events anchored to it
 * (@staff exactly equal). Refuses to remove the last staff. Undo restores
 * every element at its exact position.
 */
export class RemoveStaffCommand implements Command {
  readonly label: string;
  private removed: RemovedChild[] = [];

  constructor(private readonly staffN: number) {
    this.label = `remove staff ${staffN}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    this.removed = [];
    const n = String(this.staffN);
    const defs = findAll(ctx.score.scoreDef, "staffDef");
    if (defs.length <= 1) throw new Error("cannot remove the last staff");
    const def = defs.find((d) => (d.attrs["n"] ?? "1") === n);
    if (!def) throw new Error(`no staff ${n} in the score definitions`);
    const take = (parent: CoreElement, el: CoreElement) => {
      const at = parent.children.indexOf(el);
      this.removed.push({ parent, at, el });
      parent.children.splice(at, 1);
    };
    const defParent = (function findParent(el: CoreElement): CoreElement | null {
      for (const c of childElements(el)) {
        if (c === def) return el;
        const hit = findParent(c);
        if (hit) return hit;
      }
      return null;
    })(ctx.score.scoreDef);
    if (!defParent) throw new Error("staffDef parent not found");
    take(defParent, def);
    // Interleaved per-staff defs (mid-piece clef changes for this staff).
    for (const item of ctx.score.items) {
      if (item.kind === "def" && item.el.tag === "staffDef" && (item.el.attrs["n"] ?? "1") === n) {
        const parent = (function findIn(el: CoreElement): CoreElement | null {
          for (const c of childElements(el)) {
            if (c === item.el) return el;
            const hit = findIn(c);
            if (hit) return hit;
          }
          return null;
        })(ctx.score.scoreEl);
        if (parent) take(parent, item.el);
      }
    }
    for (const measure of ctx.score.measures) {
      for (const child of [...childElements(measure)]) {
        if (child.tag === "staff" && (child.attrs["n"] ?? "1") === n) take(measure, child);
        else if (child.tag !== "staff" && child.attrs["staff"] === n) take(measure, child); // control events on this staff
      }
    }
    refreshScore(ctx.score); // interleaved defs left the tree
    return allDirty(ctx);
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    for (const r of [...this.removed].reverse()) r.parent.children.splice(r.at, 0, r.el);
    refreshScore(ctx.score);
    return allDirty(ctx);
  }
}

/* ------------------------------------------------------------------ */

/**
 * Toggle repeat barlines (the "bis") around a measure range: @left="rptstart"
 * on the first measure, @right="rptend" on the last. Toggling off restores
 * whatever barline values were there before (double bars survive).
 */
export class ToggleRepeatCommand implements Command {
  readonly label: string;
  private memento: { first: CoreElement; left: string | undefined; last: CoreElement; right: string | undefined } | null = null;

  constructor(
    private readonly from: number,
    private readonly to: number,
  ) {
    this.label = `toggle repeat m${Math.min(from, to) + 1}–m${Math.max(from, to) + 1}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const lo = Math.min(this.from, this.to);
    const hi = Math.max(this.from, this.to);
    const first = ctx.score.measures[lo];
    const last = ctx.score.measures[hi];
    if (!first || !last) throw new Error("repeat range out of the score");
    this.memento = { first, left: first.attrs["left"], last, right: last.attrs["right"] };
    if (first.attrs["left"] === "rptstart" && last.attrs["right"] === "rptend") {
      delete first.attrs["left"];
      delete last.attrs["right"];
    } else {
      first.attrs["left"] = "rptstart";
      last.attrs["right"] = "rptend";
    }
    return [
      { measureIndex: lo, staffN: 0 },
      { measureIndex: hi, staffN: 0 },
    ];
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const m = this.memento;
    if (m.left === undefined) delete m.first.attrs["left"];
    else m.first.attrs["left"] = m.left;
    if (m.right === undefined) delete m.last.attrs["right"];
    else m.last.attrs["right"] = m.right;
    return [];
  }
}

/* ------------------------------------------------------------------ */

/**
 * Voices are layers. Adding a voice puts <layer n="max+1"><mRest/></layer>
 * into the staff in EVERY measure — visible, clickable, duration-valid
 * under any meter, and the caret grid stays uniform (same policy as
 * AddStaffCommand). Removing a voice takes the layer out everywhere and
 * cleans up control events anchored inside it; the last voice of a staff
 * is refused.
 */
export class AddVoiceCommand implements Command {
  readonly label: string;
  /** The new voice's layer number, set by apply (range max + 1). */
  layerN = 0;
  private added: RemovedChild[] = [];
  private barline: { el: CoreElement; before: string | undefined } | null = null;

  constructor(
    private readonly staffN: number,
    private readonly from = 0,
  ) {
    this.label = `add voice to staff ${staffN} from m${from + 1}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    this.added = [];
    this.barline = null;
    const n = String(this.staffN);
    const range = ctx.score.measures.slice(this.from);
    const staves = range
      .map((m) => childElements(m).find((c) => c.tag === "staff" && (c.attrs["n"] ?? "1") === n))
      .filter((s): s is CoreElement => s !== undefined);
    if (staves.length === 0) throw new Error(`no staff ${n} to add a voice to`);
    let max = 0;
    for (const staff of staves) {
      for (const layer of childElements(staff).filter((c) => c.tag === "layer")) {
        max = Math.max(max, Number(layer.attrs["n"] ?? "1"));
      }
    }
    this.layerN = max + 1;
    for (const staff of staves) {
      const layer: CoreElement = { tag: "layer", attrs: { n: String(this.layerN) }, children: [{ tag: "mRest", attrs: {}, children: [] }] };
      ensureIds(layer);
      const layers = staff.children.filter((c) => typeof c !== "string" && c.tag === "layer") as CoreElement[];
      const last = layers[layers.length - 1];
      const at = last ? staff.children.indexOf(last) + 1 : staff.children.length;
      staff.children.splice(at, 0, layer);
      this.added.push({ parent: staff, at, el: layer });
    }
    // Engraving convention: a double barline where a voice appears
    // mid-piece (left alone when a special barline is already there).
    if (this.from > 0) {
      const prev = ctx.score.measures[this.from - 1];
      if (prev && prev.attrs["right"] === undefined) {
        this.barline = { el: prev, before: undefined };
        prev.attrs["right"] = "dbl";
      }
    }
    return ctx.score.measures.slice(Math.max(0, this.from - 1)).map((_, i) => ({ measureIndex: Math.max(0, this.from - 1) + i, staffN: 0 }));
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    if (this.barline) {
      if (this.barline.before === undefined) delete this.barline.el.attrs["right"];
      else this.barline.el.attrs["right"] = this.barline.before;
    }
    for (const a of [...this.added].reverse()) {
      const i = a.parent.children.indexOf(a.el);
      if (i >= 0) a.parent.children.splice(i, 1);
    }
    return ctx.score.measures.slice(Math.max(0, this.from - 1)).map((_, i) => ({ measureIndex: Math.max(0, this.from - 1) + i, staffN: 0 }));
  }
}

export class RemoveVoiceCommand implements Command {
  readonly label: string;
  private removed: RemovedChild[] = [];

  constructor(
    private readonly staffN: number,
    private readonly layerN: number,
    private readonly from = 0,
  ) {
    this.label = `remove voice ${layerN} from staff ${staffN} from m${from + 1}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    this.removed = [];
    const sn = String(this.staffN);
    const ln = String(this.layerN);
    const range = ctx.score.measures.slice(this.from);
    // Refuse when this layer is the only one anywhere it appears in range.
    for (const measure of range) {
      const staff = childElements(measure).find((c) => c.tag === "staff" && (c.attrs["n"] ?? "1") === sn);
      if (!staff) continue;
      const layers = childElements(staff).filter((c) => c.tag === "layer");
      if (layers.some((l) => (l.attrs["n"] ?? "1") === ln) && layers.length === 1) {
        throw new Error("cannot remove the last voice of a staff");
      }
    }
    const removedIds = new Set<string>();
    const collect = (e: CoreElement): void => {
      const id = e.attrs["xml:id"];
      if (id) removedIds.add(id);
      for (const c of childElements(e)) collect(c);
    };
    const take = (parent: CoreElement, el: CoreElement) => {
      const at = parent.children.indexOf(el);
      this.removed.push({ parent, at, el });
      parent.children.splice(at, 1);
    };
    for (const measure of range) {
      const staff = childElements(measure).find((c) => c.tag === "staff" && (c.attrs["n"] ?? "1") === sn);
      if (!staff) continue;
      const layer = childElements(staff).find((c) => c.tag === "layer" && (c.attrs["n"] ?? "1") === ln);
      if (!layer) continue;
      collect(layer);
      take(staff, layer);
    }
    if (this.removed.length === 0) throw new Error(`no voice ${ln} on staff ${sn}`);
    // Control events anchored inside the removed voice go too.
    for (const measure of ctx.score.measures) {
      for (const child of [...childElements(measure)]) {
        if (child.tag === "staff") continue;
        const refs = controlRefs(child);
        if (refs.length && refs.some((r) => removedIds.has(r))) take(measure, child);
      }
    }
    refreshScore(ctx.score); // span elements may have left the tree
    return ctx.score.measures.map((_, i) => ({ measureIndex: i, staffN: this.staffN }));
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    for (const r of [...this.removed].reverse()) r.parent.children.splice(r.at, 0, r.el);
    refreshScore(ctx.score);
    return ctx.score.measures.map((_, i) => ({ measureIndex: i, staffN: this.staffN }));
  }
}

/* ------------------------------------------------------------------ */

/**
 * Volta brackets as NUMBER SETS: shift+1/2/3 toggles that number on the
 * selected range's <ending> — mixes like [1, 2][3] are one bracket with
 * n="1, 2" and one with n="3". Removing the last number unwraps the
 * bracket. After every change the sibling GROUP of endings renormalizes
 * its closing barlines: every bracket with a later sibling ends with a
 * repeat barline (rptend), the last bracket ends with a double barline —
 * unless it closes the score, whose final barline is left alone.
 */
export class ToggleVoltaCommand implements Command {
  readonly label: string;
  private steps: (
    | { op: "wrap"; parent: CoreElement; at: number; ending: CoreElement }
    | { op: "setN"; ending: CoreElement; before: string | undefined }
    | { op: "unwrap"; parent: CoreElement; at: number; ending: CoreElement }
    | { op: "barline"; el: CoreElement; before: string | undefined }
  )[] = [];
  private touchedStructure = false;

  constructor(
    private readonly from: number,
    private readonly to: number,
    private readonly n: number,
  ) {
    this.label = `toggle volta ${n} on m${Math.min(from, to) + 1}–m${Math.max(from, to) + 1}`;
  }

  private static lastMeasureIn(ending: CoreElement): CoreElement | null {
    const measures = ending.children.filter((c): c is CoreElement => typeof c !== "string" && c.tag === "measure");
    return measures[measures.length - 1] ?? null;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    this.steps = [];
    this.touchedStructure = false;
    const lo = Math.min(this.from, this.to);
    const hi = Math.max(this.from, this.to);
    const first = ctx.score.measures[lo];
    const last = ctx.score.measures[hi];
    if (!first || !last) throw new Error("volta range out of the score");
    const pFirst = ctx.score.measureParent.get(first)!;
    const pLast = ctx.score.measureParent.get(last)!;
    const setBarline = (el: CoreElement, value: string | null) => {
      const before = el.attrs["right"];
      if ((value ?? undefined) === before) return;
      this.steps.push({ op: "barline", el, before });
      if (value === null) delete el.attrs["right"];
      else el.attrs["right"] = value;
    };

    let parent: CoreElement;
    let anchorAt: number;

    if (pFirst.tag === "ending" && pFirst === pLast) {
      // Toggle this number in the existing bracket's set.
      const set = new Set(
        (pFirst.attrs["n"] ?? "")
          .split(/\s*,\s*/)
          .filter((s) => s !== "")
          .map(Number),
      );
      const gp = (function find(el: CoreElement): CoreElement | null {
        for (const c of childElements(el)) {
          if (c === pFirst) return el;
          const hit = find(c);
          if (hit) return hit;
        }
        return null;
      })(ctx.score.scoreEl);
      if (!gp) throw new Error("ending parent not found");
      parent = gp;
      anchorAt = gp.children.indexOf(pFirst);
      if (set.has(this.n)) {
        set.delete(this.n);
        if (set.size === 0) {
          const lastM = ToggleVoltaCommand.lastMeasureIn(pFirst);
          if (lastM && (lastM.attrs["right"] === "rptend" || lastM.attrs["right"] === "dbl")) setBarline(lastM, null);
          gp.children.splice(anchorAt, 1, ...pFirst.children);
          this.steps.push({ op: "unwrap", parent: gp, at: anchorAt, ending: pFirst });
          this.touchedStructure = true;
        } else {
          this.steps.push({ op: "setN", ending: pFirst, before: pFirst.attrs["n"] });
          pFirst.attrs["n"] = [...set].sort((a, b) => a - b).join(", ");
        }
      } else {
        set.add(this.n);
        this.steps.push({ op: "setN", ending: pFirst, before: pFirst.attrs["n"] });
        pFirst.attrs["n"] = [...set].sort((a, b) => a - b).join(", ");
      }
    } else if (pFirst.tag === "ending" || pLast.tag === "ending" || pFirst !== pLast) {
      throw new Error("selection crosses an ending boundary");
    } else {
      const at = pFirst.children.indexOf(first);
      const end = pFirst.children.indexOf(last);
      const slice = pFirst.children.slice(at, end + 1);
      const ending: CoreElement = { tag: "ending", attrs: { "xml:id": newId(), n: String(this.n) }, children: slice };
      pFirst.children.splice(at, slice.length, ending);
      this.steps.push({ op: "wrap", parent: pFirst, at, ending });
      this.touchedStructure = true;
      parent = pFirst;
      anchorAt = at;
    }
    if (this.touchedStructure) refreshScore(ctx.score);

    // Renormalize the closing barlines of the CONTIGUOUS ending group at
    // the anchor position (rptend before a later bracket, dbl on the last,
    // the score's own final barline left alone).
    const kids = parent.children;
    let gStart = anchorAt;
    let gEnd = anchorAt;
    const isEnding = (i: number) => {
      const c = kids[i];
      return c !== undefined && typeof c !== "string" && c.tag === "ending";
    };
    if (!isEnding(anchorAt)) {
      // the anchor was unwrapped: look around it for the surviving group
      if (isEnding(anchorAt - 1)) gStart = gEnd = anchorAt - 1;
      else {
        // scan forward past the spliced-in children for a following ending
        let i = anchorAt;
        while (i < kids.length && !isEnding(i)) i++;
        if (i < kids.length) gStart = gEnd = i;
        else gStart = gEnd = -1;
      }
    }
    if (gStart >= 0) {
      while (isEnding(gStart - 1)) gStart--;
      while (isEnding(gEnd + 1)) gEnd++;
      const group: CoreElement[] = [];
      for (let i = gStart; i <= gEnd; i++) if (isEnding(i)) group.push(kids[i] as CoreElement);
      const scoreLast = ctx.score.measures[ctx.score.measures.length - 1];
      group.forEach((ending, gi) => {
        const lastM = ToggleVoltaCommand.lastMeasureIn(ending);
        if (!lastM) return;
        if (gi < group.length - 1) setBarline(lastM, "rptend");
        else if (lastM !== scoreLast) setBarline(lastM, "dbl");
        // group-last that closes the score: leave the final barline alone
      });
    }
    return ctx.score.measures.slice(lo).map((_, i) => ({ measureIndex: lo + i, staffN: 0 }));
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    for (const s of [...this.steps].reverse()) {
      if (s.op === "barline") {
        if (s.before === undefined) delete s.el.attrs["right"];
        else s.el.attrs["right"] = s.before;
      } else if (s.op === "setN") {
        if (s.before === undefined) delete s.ending.attrs["n"];
        else s.ending.attrs["n"] = s.before;
      } else if (s.op === "wrap") {
        s.parent.children.splice(s.at, 1, ...s.ending.children);
      } else {
        s.parent.children.splice(s.at, s.ending.children.length, s.ending);
      }
    }
    if (this.touchedStructure) refreshScore(ctx.score);
    return ctx.score.measures.map((_, i) => ({ measureIndex: i, staffN: 0 }));
  }
}
