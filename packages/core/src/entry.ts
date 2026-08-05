/**
 * Note entry — overwrite-mode commands, all duration-invariant by
 * construction: entering an event REPLACES written time at the caret.
 *  - equal duration: swap in place (beams stay intact)
 *  - shorter: swap + fill the remainder with rests
 *  - longer: consume following siblings in the same container; the last
 *    partially-consumed event is replaced by rests for its remainder.
 *    Crossing a beam/tuplet/measure boundary refuses loudly (like paste).
 * mRest targets are replaced against the measure capacity.
 */
import { CoreElement, childElements } from "./xml.js";
import { refreshScore } from "./score.js";
import { Command, CommandContext, DirtyRegion } from "./commands.js";
import { EVENT_TAGS } from "./events.js";
import { Fraction, fAdd, fCmp, frac, eventDuration, decomposeDuration } from "./durations.js";
import { newId } from "./ids.js";

export interface EntrySpec {
  kind: "note" | "rest";
  pname?: string;
  oct?: number;
  accid?: string;
  dur: string;
  dots?: number;
  /** Extra attributes copied onto the created event (artic, tie, stem.dir —
   * used when re-entering an event to change its duration in place). */
  carry?: Record<string, string>;
}

const specDuration = (spec: { dur: string; dots?: number }): Fraction => {
  const base = spec.dur === "breve" ? frac(2, 1) : frac(1, Number(spec.dur));
  const dots = spec.dots ?? 0;
  return { num: base.num * (2 ** (dots + 1) - 1), den: base.den * 2 ** dots };
};

const makeEvent = (spec: EntrySpec): CoreElement => {
  const attrs: Record<string, string> = { ...(spec.carry ?? {}), "xml:id": newId(), dur: spec.dur };
  delete attrs["dots"];
  if (spec.dots) attrs["dots"] = String(spec.dots);
  if (spec.kind === "note") {
    attrs["pname"] = spec.pname ?? "c";
    attrs["oct"] = String(spec.oct ?? 4);
    delete attrs["accid"];
    if (spec.accid) attrs["accid"] = spec.accid;
  }
  return { tag: spec.kind, attrs, children: [] };
};

const makeRests = (value: Fraction): CoreElement[] =>
  decomposeDuration(value).map((d) => {
    const attrs: Record<string, string> = { "xml:id": newId(), dur: d.dur };
    if (d.dots) attrs["dots"] = String(d.dots);
    return { tag: "rest", attrs, children: [] };
  });

function locateWithParent(root: CoreElement, id: string): { el: CoreElement; parent: CoreElement; at: number } | null {
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i];
    if (c === undefined || typeof c === "string") continue;
    if (c.attrs["xml:id"] === id) return { el: c, parent: root, at: i };
    const hit = locateWithParent(c, id);
    if (hit) return hit;
  }
  return null;
}

interface SpliceMemento {
  parent: CoreElement;
  at: number;
  removed: CoreElement[];
  inserted: CoreElement[];
}

/**
 * Replace the event with the given id by a new entry of possibly different
 * written duration. `capacity` is the measure's notated capacity (for mRest
 * targets). Throws (before mutating) when the entry cannot fit.
 */
export class ReplaceEntryCommand implements Command {
  readonly label: string;
  private memento: SpliceMemento | null = null;
  /** id of the entered event (for caret placement after apply). */
  enteredId: string | null = null;

  constructor(
    private readonly targetId: string,
    private readonly spec: EntrySpec,
    private readonly capacity: Fraction,
  ) {
    this.label = `enter ${spec.kind} ${spec.pname ?? ""}${spec.dur}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const ref = ctx.index.byId.get(this.targetId);
    if (!ref) throw new Error("entry target not found");
    const measure = ctx.score.measures[ref.measureIndex];
    if (!measure) throw new Error("entry measure not found");
    const hit = locateWithParent(measure, this.targetId);
    if (!hit) throw new Error("entry target not in measure");

    const entryDur = specDuration(this.spec);
    const targetDur = hit.el.tag === "mRest" || hit.el.tag === "mSpace" ? this.capacity : eventDuration(hit.el);
    if (targetDur === null) throw new Error("target duration unknown; cannot enter here");

    const removed: CoreElement[] = [hit.el];
    let covered = targetDur;
    // Consume following events in the SAME container until covered.
    let cursor = hit.at + 1;
    while (fCmp(covered, entryDur) < 0) {
      const next = hit.parent.children[cursor];
      if (next === undefined || typeof next === "string" || !EVENT_TAGS.has(next.tag)) {
        throw new Error("entry crosses a beam/tuplet/measure boundary");
      }
      const d = next.tag === "mRest" || next.tag === "mSpace" ? this.capacity : eventDuration(next);
      if (d === null) throw new Error("cannot consume an event of unknown duration");
      removed.push(next);
      covered = fAdd(covered, d);
      cursor++;
    }
    const remainder = fAdd(covered, { num: -entryDur.num, den: entryDur.den });
    const entered = makeEvent(this.spec);
    const inserted = [entered, ...makeRests(remainder)];

    hit.parent.children.splice(hit.at, removed.length, ...inserted);
    this.memento = { parent: hit.parent, at: hit.at, removed, inserted };
    this.enteredId = entered.attrs["xml:id"] ?? null;
    return [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const m = this.memento;
    m.parent.children.splice(m.at, m.inserted.length, ...m.removed);
    return [];
  }
}

/**
 * Change the written duration of an event IN PLACE — note, rest, or chord
 * (children and all ids preserved). Shorter fills the freed time with rests;
 * longer consumes following siblings, refusing at container boundaries —
 * the same splice semantics as entry, without rebuilding the element.
 */
export class ChangeDurationCommand implements Command {
  readonly label: string;
  private memento: SpliceMemento | null = null;

  constructor(
    private readonly targetId: string,
    private readonly dur: string,
    private readonly dots: number,
    private readonly capacity: Fraction,
  ) {
    this.label = `duration ${dur}${dots ? "." : ""}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const ref = ctx.index.byId.get(this.targetId);
    if (!ref) throw new Error("duration target not found");
    if (ref.tag === "mRest" || ref.tag === "mSpace") throw new Error("a whole-measure rest has no written duration — enter into it instead");
    const measure = ctx.score.measures[ref.measureIndex];
    const hit = measure && locateWithParent(measure, this.targetId);
    if (!hit) throw new Error("duration target not in measure");
    const oldDur = eventDuration(hit.el);
    if (oldDur === null) throw new Error("target duration unknown");
    const newDur = specDuration({ dur: this.dur, dots: this.dots });

    const removed: CoreElement[] = [hit.el];
    let covered = oldDur;
    let cursor = hit.at + 1;
    while (fCmp(covered, newDur) < 0) {
      const next = hit.parent.children[cursor];
      if (next === undefined || typeof next === "string" || !EVENT_TAGS.has(next.tag)) {
        throw new Error("duration change crosses a beam/tuplet/measure boundary");
      }
      const d = next.tag === "mRest" || next.tag === "mSpace" ? this.capacity : eventDuration(next);
      if (d === null) throw new Error("cannot consume an event of unknown duration");
      removed.push(next);
      covered = fAdd(covered, d);
      cursor++;
    }
    const remainder = fAdd(covered, { num: -newDur.num, den: newDur.den });
    const changed: CoreElement = { ...hit.el, attrs: { ...hit.el.attrs, dur: this.dur } };
    if (this.dots) changed.attrs["dots"] = String(this.dots);
    else delete changed.attrs["dots"];
    const inserted = [changed, ...makeRests(remainder)];
    hit.parent.children.splice(hit.at, removed.length, ...inserted);
    this.memento = { parent: hit.parent, at: hit.at, removed, inserted };
    return [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const m = this.memento;
    m.parent.children.splice(m.at, m.inserted.length, ...m.removed);
    return [];
  }
}

/** Written pitch identity used by merge (chords compare pitch multisets). */
function pitchKey(el: CoreElement): string | null {
  if (el.tag === "rest") return "rest";
  if (el.tag === "note") return `${el.attrs["pname"]}/${el.attrs["oct"]}/${el.attrs["accid"] ?? ""}`;
  if (el.tag === "chord") {
    return childElements(el)
      .filter((c) => c.tag === "note")
      .map((n) => `${n.attrs["pname"]}/${n.attrs["oct"]}/${n.attrs["accid"] ?? ""}`)
      .sort()
      .join("+");
  }
  return null;
}

/**
 * Merge the event at id with the NEXT sibling event: same pitch (notes),
 * both rests, or identical chord pitch-sets; the summed duration must be a
 * single written value (dur + one dot). Keeps the first event's identity;
 * the inner tie pair dissolves, outer tie ends are preserved.
 */
export class MergeEventsCommand implements Command {
  readonly label = "merge with next";
  private memento: SpliceMemento | null = null;

  constructor(
    private readonly targetId: string,
    /** Measure capacity: two rests summing to it collapse into an mRest. */
    private readonly capacity?: Fraction,
  ) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    const ref = ctx.index.byId.get(this.targetId);
    if (!ref) throw new Error("merge target not found");
    const measure = ctx.score.measures[ref.measureIndex];
    const hit = measure && locateWithParent(measure, this.targetId);
    if (!hit) throw new Error("merge target not in measure");
    const next = hit.parent.children[hit.at + 1];
    if (next === undefined || typeof next === "string" || !EVENT_TAGS.has(next.tag)) {
      throw new Error("nothing mergeable follows (same beam/measure required)");
    }
    const a = hit.el;
    const b = next;
    const ka = pitchKey(a);
    const kb = pitchKey(b);
    if (ka === null || kb === null || a.tag !== b.tag) throw new Error("merge needs two notes, two rests, or two chords");
    if (ka !== kb) throw new Error("merge requires the same pitch");
    const da = eventDuration(a);
    const db = eventDuration(b);
    if (!da || !db) throw new Error("cannot merge events of unknown duration");
    const sum = fAdd(da, db);
    // Two rests filling the whole measure collapse into an mRest.
    if (a.tag === "rest" && this.capacity && fCmp(sum, this.capacity) === 0 && hit.parent.tag === "layer" && hit.parent.children.filter((c) => typeof c !== "string" && EVENT_TAGS.has(c.tag)).length === 2) {
      const mRest: CoreElement = { tag: "mRest", attrs: { "xml:id": a.attrs["xml:id"] ?? newId() }, children: [] };
      hit.parent.children.splice(hit.at, 2, mRest);
      this.memento = { parent: hit.parent, at: hit.at, removed: [a, b], inserted: [mRest] };
      return [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
    }
    const parts = decomposeDuration(sum);
    if (parts.length !== 1) throw new Error(`${"combined duration is not a single written value"}`);
    const merged = { ...a, attrs: { ...a.attrs }, children: a.children.map((c) => (typeof c === "string" ? c : { ...c, attrs: { ...c.attrs } })) };
    merged.attrs["dur"] = parts[0]!.dur;
    if (parts[0]!.dots) merged.attrs["dots"] = String(parts[0]!.dots);
    else delete merged.attrs["dots"];
    // Ties: the pair between a and b dissolves; outer ends survive.
    const aIn = a.attrs["tie"] === "t" || a.attrs["tie"] === "m";
    const bOut = b.attrs["tie"] === "i" || b.attrs["tie"] === "m";
    if (aIn && bOut) merged.attrs["tie"] = "m";
    else if (aIn) merged.attrs["tie"] = "t";
    else if (bOut) merged.attrs["tie"] = "i";
    else delete merged.attrs["tie"];
    hit.parent.children.splice(hit.at, 2, merged);
    this.memento = { parent: hit.parent, at: hit.at, removed: [a, b], inserted: [merged] };
    return [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const m = this.memento;
    m.parent.children.splice(m.at, m.inserted.length, ...m.removed);
    return [];
  }
}

/**
 * Split the event at id into two halves in place: dur doubles, dots stay
 * (a dotted half becomes two dotted quarters). The first half keeps the
 * event's identity; ties redistribute (t stays on the first, i moves to
 * the second). mRest targets are refused — enter into them instead.
 */
export class SplitEventCommand implements Command {
  readonly label = "split in half";
  private memento: SpliceMemento | null = null;

  constructor(
    private readonly targetId: string,
    /** Measure capacity: lets an mRest split into two half-measure rests. */
    private readonly capacity?: Fraction,
  ) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    const ref = ctx.index.byId.get(this.targetId);
    if (!ref) throw new Error("split target not found");
    const measure = ctx.score.measures[ref.measureIndex];
    const hit = measure && locateWithParent(measure, this.targetId);
    if (!hit) throw new Error("split target not in measure");
    const el = hit.el;
    if (el.tag === "mRest" || el.tag === "mSpace") {
      if (!this.capacity) throw new Error("cannot split a whole-measure rest without the measure capacity");
      // mRest -> two half-capacity rest runs (odd meters may need several
      // rests per half); the first rest keeps the mRest's identity.
      const half = frac(this.capacity.num, this.capacity.den * 2);
      const rests = [...makeRests(half), ...makeRests(half)];
      if (rests[0]) rests[0].attrs["xml:id"] = el.attrs["xml:id"] ?? rests[0].attrs["xml:id"]!;
      hit.parent.children.splice(hit.at, 1, ...rests);
      this.memento = { parent: hit.parent, at: hit.at, removed: [el], inserted: rests };
      return [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
    }
    if (!EVENT_TAGS.has(el.tag)) throw new Error("split target is not an event");
    const dur = el.attrs["dur"];
    if (!dur) throw new Error("cannot split an event without a written duration");
    const halfDur = dur === "long" ? "breve" : dur === "breve" ? "1" : String(Number(dur) * 2);
    if (Number(halfDur) > 128) throw new Error("cannot split below a 128th");

    const clone = (e: CoreElement): CoreElement => {
      const copy: CoreElement = { tag: e.tag, attrs: { ...e.attrs, "xml:id": newId() }, children: e.children.map((c) => (typeof c === "string" ? c : clone(c))) };
      return copy;
    };
    const first = { ...el, attrs: { ...el.attrs }, children: el.children };
    const second = clone(el);
    first.attrs["dur"] = halfDur;
    second.attrs["dur"] = halfDur;
    // Ties: incoming stays on the first half, outgoing moves to the second.
    const tie = el.attrs["tie"];
    delete first.attrs["tie"];
    delete second.attrs["tie"];
    if (tie === "t" || tie === "m") first.attrs["tie"] = "t";
    if (tie === "i" || tie === "m") second.attrs["tie"] = "i";
    hit.parent.children.splice(hit.at, 1, first, second);
    this.memento = { parent: hit.parent, at: hit.at, removed: [el], inserted: [first, second] };
    return [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const m = this.memento;
    m.parent.children.splice(m.at, m.inserted.length, ...m.removed);
    return [];
  }
}

/** Add a pitch to the event at id: a note becomes a chord; a chord grows. */
export class AddChordNoteCommand implements Command {
  readonly label: string;
  private memento: { parent: CoreElement; at: number; before: CoreElement; after: CoreElement } | null = null;
  /** Id of the chord after apply — promotion gives the chord a NEW id, so
   * callers stacking further pitches must retarget through this. */
  resultId: string | null = null;

  constructor(
    private readonly targetId: string,
    private readonly pname: string,
    private readonly oct: number,
    private readonly accid?: string,
  ) {
    this.label = `chord +${pname}${oct}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const ref = ctx.index.byId.get(this.targetId);
    if (!ref) throw new Error("chord target not found");
    const measure = ctx.score.measures[ref.measureIndex];
    const hit = measure && locateWithParent(measure, this.targetId);
    if (!hit) throw new Error("chord target not in measure");
    const el = hit.el;
    if (el.tag !== "note" && el.tag !== "chord") throw new Error("can only build chords on notes");

    const newNote: CoreElement = { tag: "note", attrs: { "xml:id": newId(), pname: this.pname, oct: String(this.oct) }, children: [] };
    if (this.accid) newNote.attrs["accid"] = this.accid;

    let after: CoreElement;
    if (el.tag === "note") {
      // Promote to a chord; duration/dots move to the chord.
      const chordAttrs: Record<string, string> = { "xml:id": newId() };
      for (const k of ["dur", "dots", "stem.dir"]) {
        if (el.attrs[k] !== undefined) chordAttrs[k] = el.attrs[k]!;
      }
      const first = { ...el, attrs: { ...el.attrs } };
      delete first.attrs["dur"];
      delete first.attrs["dots"];
      after = { tag: "chord", attrs: chordAttrs, children: [first, newNote] };
    } else {
      const exists = childElements(el).some((n) => n.tag === "note" && n.attrs["pname"] === this.pname && n.attrs["oct"] === String(this.oct));
      if (exists) throw new Error("pitch already in chord");
      after = { ...el, attrs: { ...el.attrs }, children: [...el.children, newNote] };
    }
    hit.parent.children[hit.at] = after;
    this.memento = { parent: hit.parent, at: hit.at, before: el, after };
    this.resultId = after.attrs["xml:id"] ?? null;
    return [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (this.memento) this.memento.parent.children[this.memento.at] = this.memento.before;
    return [];
  }
}

/** Toggle a tie between the event at id and the next event in its layer. */
export class ToggleTieCommand implements Command {
  readonly label = "toggle tie";
  private memento: { el: CoreElement; next: CoreElement; before: [string | undefined, string | undefined] } | null = null;

  constructor(private readonly targetId: string) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    const ref = ctx.index.byId.get(this.targetId);
    if (!ref) throw new Error("tie target not found");
    const events = ctx.index.eventsAt(ref.measureIndex, ref.staffN, ref.layerN);
    const nextId = events[ref.eventIndex + 1];
    // Ties may also cross into the next measure's first event.
    const nextRef = nextId
      ? ctx.index.byId.get(nextId)
      : (() => {
          const ids = ctx.index.eventsAt(ref.measureIndex + 1, ref.staffN, ref.layerN);
          return ids[0] ? ctx.index.byId.get(ids[0]) : undefined;
        })();
    if (!nextRef) throw new Error("no following event to tie to");
    const findEl = (r: { measureIndex: number }, id: string) => {
      const m = ctx.score.measures[r.measureIndex];
      return m ? locateWithParent(m, id)?.el : undefined;
    };
    const el = findEl(ref, this.targetId);
    const next = findEl(nextRef, nextRef.id);
    if (!el || !next) throw new Error("tie endpoints not found");
    if (el.tag !== "note" || next.tag !== "note") throw new Error("ties connect single notes");
    if (el.attrs["pname"] !== next.attrs["pname"] || el.attrs["oct"] !== next.attrs["oct"]) {
      throw new Error("tie requires the same pitch on both notes");
    }
    this.memento = { el, next, before: [el.attrs["tie"], next.attrs["tie"]] };
    if (el.attrs["tie"] === "i" && next.attrs["tie"] === "t") {
      delete el.attrs["tie"];
      delete next.attrs["tie"];
    } else {
      el.attrs["tie"] = "i";
      next.attrs["tie"] = "t";
    }
    return [
      { measureIndex: ref.measureIndex, staffN: ref.staffN },
      { measureIndex: nextRef.measureIndex, staffN: nextRef.staffN },
    ];
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const { el, next, before } = this.memento;
    if (before[0] === undefined) delete el.attrs["tie"];
    else el.attrs["tie"] = before[0];
    if (before[1] === undefined) delete next.attrs["tie"];
    else next.attrs["tie"] = before[1];
    return [];
  }
}

/**
 * Toggle a tie CHAIN over a run of same-pitch notes, any number of measures
 * apart (a note held across measures is a chain of ties, never one curve
 * skipping content). Uses proper MEI @tie values: i (initial), m (medial),
 * t (terminal) — and merges with ties continuing beyond the run's edges.
 * One command = one undo step for the whole chain.
 */
export class ChainTieCommand implements Command {
  readonly label = "toggle tie chain";
  private mementos: { el: CoreElement; before: string | undefined }[] = [];
  private region: DirtyRegion[] = [];

  constructor(private readonly ids: string[]) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    if (this.ids.length < 2) throw new Error("a tie chain needs at least two notes");
    const refs = this.ids.map((id) => {
      const r = ctx.index.byId.get(id);
      if (!r) throw new Error("tie target not found");
      return r;
    });
    const els = refs.map((r, i) => {
      const m = ctx.score.measures[r.measureIndex];
      const el = m && locateWithParent(m, this.ids[i]!)?.el;
      if (!el) throw new Error("tie target not found");
      if (el.tag !== "note") throw new Error("ties connect single notes");
      return el;
    });
    for (let i = 1; i < refs.length; i++) {
      const a = refs[i - 1]!, b = refs[i]!;
      if (a.staffN !== b.staffN || a.layerN !== b.layerN) throw new Error("a tie chain stays in one staff and layer");
      const consecutive =
        (b.measureIndex === a.measureIndex && b.eventIndex === a.eventIndex + 1) ||
        (b.measureIndex === a.measureIndex + 1 && b.eventIndex === 0 && a.eventIndex === ctx.index.eventsAt(a.measureIndex, a.staffN, a.layerN).length - 1);
      if (!consecutive) throw new Error(`tie chain must be consecutive notes (gap after note ${i})`);
      if (els[i - 1]!.attrs["pname"] !== els[i]!.attrs["pname"] || els[i - 1]!.attrs["oct"] !== els[i]!.attrs["oct"]) {
        throw new Error(`tie requires the same pitch along the chain (note ${i + 1} differs)`);
      }
    }
    this.mementos = els.map((el) => ({ el, before: el.attrs["tie"] }));
    this.region = refs.map((r) => ({ measureIndex: r.measureIndex, staffN: r.staffN }));
    const tiedIn = (v: string | undefined) => v === "t" || v === "m";
    const tiedOut = (v: string | undefined) => v === "i" || v === "m";
    const fullyTied = els.every((el, i) => (i === 0 || tiedIn(el.attrs["tie"])) && (i === els.length - 1 || tiedOut(el.attrs["tie"])));
    els.forEach((el, i) => {
      const before = el.attrs["tie"];
      const first = i === 0, last = i === els.length - 1;
      if (fullyTied) {
        // Untie the run, preserving ties that continue past its edges.
        if (first && tiedIn(before)) el.attrs["tie"] = "t";
        else if (last && before === "m") el.attrs["tie"] = "i";
        else delete el.attrs["tie"];
      } else {
        if (first) el.attrs["tie"] = tiedIn(before) ? "m" : "i";
        else if (last) el.attrs["tie"] = before === "m" || before === "i" ? "m" : "t";
        else el.attrs["tie"] = "m";
      }
    });
    return this.region;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    for (const m of [...this.mementos].reverse()) {
      if (m.before === undefined) delete m.el.attrs["tie"];
      else m.el.attrs["tie"] = m.before;
    }
    return this.region;
  }
}

/**
 * Toggle a slur between two events, any number of measures apart. The
 * <slur> control event lives in the START event's measure (standard MEI) —
 * tile synthesis segments boundary-crossing curves into continuation stubs,
 * so the document keeps the real element and save stays a plain serialize.
 */
export class ToggleSlurCommand implements Command {
  readonly label = "toggle slur";
  private memento: { measure: CoreElement; at: number; el: CoreElement; added: boolean } | null = null;
  private region: DirtyRegion[] = [];

  constructor(
    private readonly startId: string,
    private readonly endId: string,
  ) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    const deref = (v: string | undefined) => (v ? v.replace(/^#/, "") : undefined);
    let a = ctx.index.byId.get(this.startId);
    let b = ctx.index.byId.get(this.endId);
    if (!a || !b) throw new Error("slur endpoints not found");
    if (a.id === b.id) throw new Error("a slur needs two different events");
    if (a.staffN !== b.staffN || a.layerN !== b.layerN) throw new Error("slur endpoints must share a staff and layer");
    if (a.tag === "rest" || a.tag === "mRest" || b.tag === "rest" || b.tag === "mRest") throw new Error("slurs connect notes or chords");
    if (a.measureIndex > b.measureIndex || (a.measureIndex === b.measureIndex && a.eventIndex > b.eventIndex)) [a, b] = [b, a];
    const measure = ctx.score.measures[a.measureIndex];
    if (!measure) throw new Error("start measure not found");
    this.region = [];
    for (let m = a.measureIndex; m <= b.measureIndex; m++) this.region.push({ measureIndex: m, staffN: a.staffN });
    const at = measure.children.findIndex(
      (c) => typeof c !== "string" && c.tag === "slur" && deref(c.attrs["startid"]) === a!.id && deref(c.attrs["endid"]) === b!.id,
    );
    if (at >= 0) {
      this.memento = { measure, at, el: measure.children[at] as CoreElement, added: false };
      measure.children.splice(at, 1);
    } else {
      const el: CoreElement = {
        tag: "slur",
        attrs: { "xml:id": newId(), startid: `#${a.id}`, endid: `#${b.id}`, staff: String(a.staffN) },
        children: [],
      };
      measure.children.push(el);
      this.memento = { measure, at: measure.children.length - 1, el, added: true };
    }
    // New measures array -> the tile span-end index rebuilds (it caches per
    // score.measures identity; a stale index would drop the incoming stub).
    refreshScore(ctx.score);
    return this.region;
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const { measure, at, el, added } = this.memento;
    if (added) {
      const i = measure.children.indexOf(el);
      if (i >= 0) measure.children.splice(i, 1);
    } else {
      measure.children.splice(at, 0, el);
    }
    refreshScore(ctx.score);
    return this.region;
  }
}

/** Toggle an articulation (@artic space-separated list) on notes/chords. */
export class ToggleArticCommand implements Command {
  readonly label: string;
  private mementos: { el: CoreElement; before: string | undefined }[] = [];

  constructor(
    private readonly ids: string[],
    private readonly artic: string,
  ) {
    this.label = `toggle ${artic}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    this.mementos = [];
    const dirty: DirtyRegion[] = [];
    for (const id of this.ids) {
      const ref = ctx.index.byId.get(id);
      if (!ref || (ref.tag !== "note" && ref.tag !== "chord")) continue;
      const measure = ctx.score.measures[ref.measureIndex];
      const el = measure && locateWithParent(measure, id)?.el;
      if (!el) continue;
      this.mementos.push({ el, before: el.attrs["artic"] });
      const list = (el.attrs["artic"] ?? "").split(/\s+/).filter(Boolean);
      const at = list.indexOf(this.artic);
      if (at >= 0) list.splice(at, 1);
      else list.push(this.artic);
      if (list.length) el.attrs["artic"] = list.join(" ");
      else delete el.attrs["artic"];
      dirty.push({ measureIndex: ref.measureIndex, staffN: ref.staffN });
    }
    return dirty;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    for (const m of this.mementos) {
      if (m.before === undefined) delete m.el.attrs["artic"];
      else m.el.attrs["artic"] = m.before;
    }
    return [];
  }
}

/** Cycle the <dynam> anchored at the event: none -> p -> f -> none. */
export class CycleDynamCommand implements Command {
  readonly label = "cycle dynamic";
  private memento: { measure: CoreElement; at: number; before: CoreElement | null; after: CoreElement | null } | null = null;

  constructor(private readonly targetId: string) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    const ref = ctx.index.byId.get(this.targetId);
    if (!ref) throw new Error("dynamic target not found");
    const measure = ctx.score.measures[ref.measureIndex];
    if (!measure) throw new Error("measure not found");
    const existing = childElements(measure).find((c) => c.tag === "dynam" && c.attrs["startid"] === `#${this.targetId}`) ?? null;
    const value = existing?.children[0];
    if (!existing) {
      const dynam: CoreElement = { tag: "dynam", attrs: { "xml:id": newId(), staff: String(ref.staffN), startid: `#${this.targetId}` }, children: ["p"] };
      measure.children.push(dynam);
      this.memento = { measure, at: measure.children.length - 1, before: null, after: dynam };
    } else if (value === "p") {
      const at = measure.children.indexOf(existing);
      const next: CoreElement = { ...existing, attrs: { ...existing.attrs }, children: ["f"] };
      measure.children[at] = next;
      this.memento = { measure, at, before: existing, after: next };
    } else {
      const at = measure.children.indexOf(existing);
      measure.children.splice(at, 1);
      this.memento = { measure, at, before: existing, after: null };
    }
    return [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const m = this.memento;
    if (m.before === null && m.after) m.measure.children.splice(m.measure.children.indexOf(m.after), 1);
    else if (m.after === null && m.before) m.measure.children.splice(m.at, 0, m.before);
    else if (m.before) m.measure.children[m.at] = m.before;
    return [];
  }
}

/** Toggle a <dynam> anchored at the event (same value toggles off). */
export class ToggleDynamCommand implements Command {
  readonly label: string;
  private memento: { measure: CoreElement; at: number; el: CoreElement; added: boolean } | null = null;

  constructor(
    private readonly targetId: string,
    private readonly value: string,
  ) {
    this.label = `dynamic ${value}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const ref = ctx.index.byId.get(this.targetId);
    if (!ref) throw new Error("dynamic target not found");
    const measure = ctx.score.measures[ref.measureIndex];
    if (!measure) throw new Error("measure not found");
    const existing = childElements(measure).find(
      (c) => c.tag === "dynam" && c.attrs["startid"] === `#${this.targetId}` && c.children.length === 1 && c.children[0] === this.value,
    );
    if (existing) {
      const at = measure.children.indexOf(existing);
      measure.children.splice(at, 1);
      this.memento = { measure, at, el: existing, added: false };
    } else {
      const dynam: CoreElement = {
        tag: "dynam",
        attrs: { "xml:id": newId(), staff: String(ref.staffN), startid: `#${this.targetId}` },
        children: [this.value],
      };
      measure.children.push(dynam);
      this.memento = { measure, at: measure.children.length - 1, el: dynam, added: true };
    }
    return [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const m = this.memento;
    if (m.added) m.measure.children.splice(m.measure.children.indexOf(m.el), 1);
    else m.measure.children.splice(m.at, 0, m.el);
    return [];
  }
}
