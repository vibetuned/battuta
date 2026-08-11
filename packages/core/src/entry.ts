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
import { Fraction, fAdd, fCmp, fMul, frac, eventDuration, decomposeDuration } from "./durations.js";
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
    const targetDur = hit.el.tag === "mRest" || hit.el.tag === "mSpace" || hit.el.tag === "mRpt" || hit.el.tag === "mRpt2" ? this.capacity : eventDuration(hit.el);
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
    // Chain-aware toggling: a note can terminate one tie AND initiate the
    // next (n_n_n) — that's @tie="m". The link el→next exists iff el
    // initiates (i|m) and next terminates (m|t).
    const a = el.attrs["tie"];
    const b = next.attrs["tie"];
    if ((a === "i" || a === "m") && (b === "m" || b === "t")) {
      // remove THIS link; whatever each note does with its other side stays
      if (a === "m") el.attrs["tie"] = "t";
      else delete el.attrs["tie"];
      if (b === "m") next.attrs["tie"] = "i";
      else delete next.attrs["tie"];
    } else {
      // create the link; a note already tied on its other side becomes "m"
      el.attrs["tie"] = a === "t" || a === "m" ? "m" : "i";
      next.attrs["tie"] = b === "i" || b === "m" ? "m" : "t";
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
    // Cross-staff slurs are legal (piano hand-crossing lines); MEI takes
    // both staves in @staff and Verovio resolves the endpoints itself.
    if (a.tag === "rest" || a.tag === "mRest" || b.tag === "rest" || b.tag === "mRest") throw new Error("slurs connect notes or chords");
    if (a.measureIndex > b.measureIndex || (a.measureIndex === b.measureIndex && a.eventIndex > b.eventIndex)) [a, b] = [b, a];
    const measure = ctx.score.measures[a.measureIndex];
    if (!measure) throw new Error("start measure not found");
    this.region = [];
    for (let m = a.measureIndex; m <= b.measureIndex; m++) {
      this.region.push({ measureIndex: m, staffN: a.staffN });
      if (b.staffN !== a.staffN) this.region.push({ measureIndex: m, staffN: b.staffN });
    }
    const at = measure.children.findIndex(
      (c) => typeof c !== "string" && c.tag === "slur" && deref(c.attrs["startid"]) === a!.id && deref(c.attrs["endid"]) === b!.id,
    );
    if (at >= 0) {
      this.memento = { measure, at, el: measure.children[at] as CoreElement, added: false };
      measure.children.splice(at, 1);
    } else {
      const staff = a.staffN === b.staffN ? String(a.staffN) : `${Math.min(a.staffN, b.staffN)} ${Math.max(a.staffN, b.staffN)}`;
      const el: CoreElement = {
        tag: "slur",
        attrs: { "xml:id": newId(), startid: `#${a.id}`, endid: `#${b.id}`, staff },
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
/**
 * Toggle fingering on a note/chord — <fing startid place="above"> control
 * events, text = the finger number; several stack vertically (Verovio
 * renders them; <fingGrp> is unsupported there, so plural = plural <fing>).
 *  - plain (additive=false): SET the fingering — replaces whatever is
 *    there; the same single number again removes it.
 *  - additive=true: add one more finger; an already-present number is
 *    removed instead (per-number toggle within the set).
 */
/** The fing texts anchored at an event (for the finger-change editor). */
export function fingTextsAt(measure: CoreElement, targetId: string): string[] {
  return childElements(measure)
    .filter((c) => c.tag === "fing" && (c.attrs["startid"] ?? "").replace(/^#/, "") === targetId)
    .map((el) => el.children.filter((c): c is string => typeof c === "string").join(""));
}

export class ToggleFingCommand implements Command {
  readonly label: string;
  private removed: { at: number; el: CoreElement }[] = [];
  private addedEl: CoreElement | null = null;
  private measure: CoreElement | null = null;
  private region: DirtyRegion[] = [];

  constructor(
    private readonly targetId: string,
    private readonly finger: string,
    private readonly additive = false,
  ) {
    this.label = `${additive ? "add" : "set"} fingering ${finger}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const ref = ctx.index.byId.get(this.targetId);
    if (!ref) throw new Error("fingering target not found");
    if (ref.tag !== "note" && ref.tag !== "chord") throw new Error("fingering attaches to notes or chords");
    const measure = ctx.score.measures[ref.measureIndex];
    if (!measure) throw new Error("measure not found");
    this.removed = [];
    this.addedEl = null;
    this.measure = measure;
    this.region = [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
    const mine: { at: number; el: CoreElement }[] = [];
    measure.children.forEach((c, at) => {
      if (typeof c !== "string" && c.tag === "fing" && (c.attrs["startid"] ?? "").replace(/^#/, "") === this.targetId) mine.push({ at, el: c });
    });
    const textOf = (el: CoreElement) => el.children.filter((c): c is string => typeof c === "string").join("");
    const hit = mine.find((m) => textOf(m.el) === this.finger);
    const remove = (entries: { at: number; el: CoreElement }[]) => {
      for (const e of [...entries].sort((a, b) => b.at - a.at)) {
        measure.children.splice(e.at, 1);
        this.removed.push(e);
      }
    };
    const add = () => {
      const fing: CoreElement = { tag: "fing", attrs: { "xml:id": newId(), staff: String(ref.staffN), startid: `#${this.targetId}`, place: "above" }, children: [this.finger] };
      measure.children.push(fing);
      this.addedEl = fing;
    };
    if (this.additive) {
      if (hit) remove([hit]);
      else add();
    } else {
      if (hit && mine.length === 1) remove([hit]); // same single number -> off
      else {
        remove(mine);
        add();
      }
    }
    return this.region;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    const measure = this.measure;
    if (!measure) return [];
    if (this.addedEl) {
      const i = measure.children.indexOf(this.addedEl);
      if (i >= 0) measure.children.splice(i, 1);
    }
    // Removals were recorded high-to-low; restore low-to-high.
    for (const r of [...this.removed].reverse()) measure.children.splice(r.at, 0, r.el);
    return this.region;
  }
}

/**
 * Cycle a hairpin over [startId, endId]: none -> crescendo -> decrescendo
 * -> none. The <hairpin> lives in the START measure (a span control event
 * — tile segmentation stubs it across boundaries like slurs). One undo
 * step per press.
 */
export class CycleHairpinCommand implements Command {
  readonly label = "cycle hairpin";
  private memento: { measure: CoreElement; at: number; before: CoreElement | null; after: CoreElement | null } | null = null;
  private region: DirtyRegion[] = [];

  constructor(
    private readonly startId: string,
    private readonly endId: string,
  ) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    const deref = (v: string | undefined) => (v ? v.replace(/^#/, "") : undefined);
    let a = ctx.index.byId.get(this.startId);
    let b = ctx.index.byId.get(this.endId);
    if (!a || !b) throw new Error("hairpin endpoints not found");
    if (a.id === b.id) throw new Error("a hairpin needs two different events");
    if (a.staffN !== b.staffN || a.layerN !== b.layerN) throw new Error("hairpin endpoints must share a staff and layer");
    if (a.measureIndex > b.measureIndex || (a.measureIndex === b.measureIndex && a.eventIndex > b.eventIndex)) [a, b] = [b, a];
    const measure = ctx.score.measures[a.measureIndex];
    if (!measure) throw new Error("start measure not found");
    this.region = [];
    for (let m = a.measureIndex; m <= b.measureIndex; m++) this.region.push({ measureIndex: m, staffN: a.staffN });
    const existing = childElements(measure).find(
      (c) => c.tag === "hairpin" && deref(c.attrs["startid"]) === a!.id && deref(c.attrs["endid"]) === b!.id,
    ) ?? null;
    if (!existing) {
      const hairpin: CoreElement = {
        tag: "hairpin",
        attrs: { "xml:id": newId(), staff: String(a.staffN), form: "cres", startid: `#${a.id}`, endid: `#${b.id}` },
        children: [],
      };
      measure.children.push(hairpin);
      this.memento = { measure, at: measure.children.length - 1, before: null, after: hairpin };
    } else if (existing.attrs["form"] === "cres") {
      const at = measure.children.indexOf(existing);
      const next: CoreElement = { ...existing, attrs: { ...existing.attrs, form: "dim" }, children: [...existing.children] };
      measure.children[at] = next;
      this.memento = { measure, at, before: existing, after: next };
    } else {
      const at = measure.children.indexOf(existing);
      measure.children.splice(at, 1);
      this.memento = { measure, at, before: existing, after: null };
    }
    // New measures array -> the tile span-end index rebuilds (stale index
    // would drop the incoming stub on the end tile — the slur lesson).
    refreshScore(ctx.score);
    return this.region;
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const m = this.memento;
    if (m.before === null && m.after) m.measure.children.splice(m.measure.children.indexOf(m.after), 1);
    else if (m.after === null && m.before) m.measure.children.splice(m.at, 0, m.before);
    else if (m.before) m.measure.children[m.at] = m.before;
    refreshScore(ctx.score);
    return this.region;
  }
}

export type MarkKind = "fermata" | "coda";

/**
 * The o-key cycle, in order. "To Coda" shares func="coda" with the coda
 * SIGN — MEI has no separate func — the TEXT CONTENT is the difference:
 * bare = the 𝄌 destination glyph, text = the jump-out marker (Verovio
 * renders whichever is present).
 */
const REPEAT_MARKS: { func: string; text?: string }[] = [
  { func: "coda" },
  { func: "coda", text: "To Coda" },
  { func: "segno" },
  { func: "fine" },
  { func: "dalSegno" },
  { func: "daCapo" },
];

const markText = (el: CoreElement): string => el.children.filter((c): c is string => typeof c === "string").join("");

/** Which cycle state an existing repeatMark is in (-1 = unknown). */
const repeatMarkState = (el: CoreElement): number => REPEAT_MARKS.findIndex((m) => m.func === el.attrs["func"] && (m.text ?? "") === markText(el).trim());

/**
 * Toggle a single mark on an event: fermata (<fermata>) or coda
 * (<repeatMark func="coda"> — MEI 5's repeat-mark element, which Verovio
 * renders). Same shape as the dynam toggle: one control event anchored by
 * startid in the event's measure.
 */
export class ToggleMarkCommand implements Command {
  readonly label: string;
  private memento: { measure: CoreElement; at: number; before: CoreElement | null; after: CoreElement | null } | null = null;
  private region: DirtyRegion[] = [];

  constructor(
    private readonly targetId: string,
    private readonly kind: MarkKind,
  ) {
    this.label = `toggle ${kind}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const ref = ctx.index.byId.get(this.targetId);
    if (!ref) throw new Error(`${this.kind} target not found`);
    const measure = ctx.score.measures[ref.measureIndex];
    if (!measure) throw new Error("measure not found");
    const tag = this.kind === "fermata" ? "fermata" : "repeatMark";
    const existing = childElements(measure).find(
      (c) => c.tag === tag && (c.attrs["startid"] ?? "").replace(/^#/, "") === this.targetId,
    ) ?? null;
    this.region = [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
    const state = existing && this.kind === "coda" ? repeatMarkState(existing) : -1;
    if (existing && this.kind === "coda" && state >= 0 && state < REPEAT_MARKS.length - 1) {
      // the repeat-mark key cycles: coda -> To Coda -> segno -> fine ->
      // dal segno -> da capo -> off
      const nextMark = REPEAT_MARKS[state + 1]!;
      const at = measure.children.indexOf(existing);
      const next: CoreElement = { ...existing, attrs: { ...existing.attrs, func: nextMark.func }, children: nextMark.text ? [nextMark.text] : [] };
      measure.children[at] = next;
      this.memento = { measure, at, before: existing, after: next };
    } else if (existing) {
      const at = measure.children.indexOf(existing);
      measure.children.splice(at, 1);
      this.memento = { measure, at, before: existing, after: null };
    } else {
      const attrs: Record<string, string> = { "xml:id": newId(), staff: String(ref.staffN), startid: `#${this.targetId}` };
      if (this.kind === "coda") attrs["func"] = "coda";
      const el: CoreElement = { tag, attrs, children: [] };
      measure.children.push(el);
      this.memento = { measure, at: measure.children.length - 1, before: null, after: el };
    }
    return this.region;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const m = this.memento;
    if (m.before === null && m.after) m.measure.children.splice(m.measure.children.indexOf(m.after), 1);
    else if (m.after === null && m.before) m.measure.children.splice(m.at, 0, m.before);
    else if (m.before) m.measure.children[m.at] = m.before;
    return this.region;
  }
}

type OrnamentState = "none" | "arpeg" | "btrem" | "trill" | "mordent";

/**
 * One key circles the four ornaments: arpeggio → tremolo → trill →
 * mordent → none. Arpeggio only makes sense on chords (single notes skip
 * straight to tremolo). Mixed encodings, hidden behind the cycle:
 * arpeg/trill/mordent are startid control events; tremolo WRAPS the event
 * in <bTrem unitdur="16"> (ids untouched — the index walks containers).
 */
export class OrnamentCycleCommand implements Command {
  readonly label = "cycle ornament";
  private steps: (
    | { op: "removeControl"; measure: CoreElement; at: number; el: CoreElement }
    | { op: "addControl"; measure: CoreElement; el: CoreElement }
    | { op: "wrap"; parent: CoreElement; at: number; wrapper: CoreElement }
    | { op: "unwrap"; parent: CoreElement; at: number; wrapper: CoreElement }
  )[] = [];
  private region: DirtyRegion[] = [];

  constructor(private readonly targetId: string) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    this.steps = [];
    const ref = ctx.index.byId.get(this.targetId);
    if (!ref) throw new Error("ornament target not found");
    if (ref.tag !== "note" && ref.tag !== "chord") throw new Error("ornaments attach to notes or chords");
    const measure = ctx.score.measures[ref.measureIndex];
    const hit = measure && locateWithParent(measure, this.targetId);
    if (!measure || !hit) throw new Error("ornament target not in measure");
    this.region = [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
    const deref = (v: string | undefined) => (v ? v.replace(/^#/, "") : undefined);
    const control = (tag: string) => childElements(measure).find((c) => c.tag === tag && deref(c.attrs["startid"]) === this.targetId) ?? null;

    const current: OrnamentState =
      hit.parent.tag === "bTrem" ? "btrem"
      : control("arpeg") ? "arpeg"
      : control("trill") ? "trill"
      : control("mordent") ? "mordent"
      : "none";
    const order: OrnamentState[] = ref.tag === "chord" ? ["none", "arpeg", "btrem", "trill", "mordent"] : ["none", "btrem", "trill", "mordent"];
    const next = order[(order.indexOf(current) + 1) % order.length]!;

    const removeControl = (tag: string) => {
      const el = control(tag)!;
      const at = measure.children.indexOf(el);
      measure.children.splice(at, 1);
      this.steps.push({ op: "removeControl", measure, at, el });
    };
    const addControl = (tag: string, extra: Record<string, string> = {}) => {
      const el: CoreElement = { tag, attrs: { "xml:id": newId(), staff: String(ref.staffN), startid: `#${this.targetId}`, ...extra }, children: [] };
      measure.children.push(el);
      this.steps.push({ op: "addControl", measure, el });
    };
    // leave the current state…
    if (current === "arpeg") removeControl("arpeg");
    else if (current === "trill") removeControl("trill");
    else if (current === "mordent") removeControl("mordent");
    else if (current === "btrem") {
      const wrapper = hit.parent;
      const gp = locateWithParent(measure, wrapper.attrs["xml:id"] ?? "");
      if (!gp) throw new Error("tremolo wrapper not found");
      gp.parent.children.splice(gp.at, 1, ...wrapper.children);
      this.steps.push({ op: "unwrap", parent: gp.parent, at: gp.at, wrapper });
    }
    // …and enter the next one
    if (next === "arpeg") addControl("arpeg");
    else if (next === "trill") addControl("trill");
    else if (next === "mordent") addControl("mordent", { form: "upper" });
    else if (next === "btrem") {
      const fresh = locateWithParent(measure, this.targetId)!;
      const wrapper: CoreElement = { tag: "bTrem", attrs: { "xml:id": newId(), unitdur: "16" }, children: [fresh.el] };
      fresh.parent.children.splice(fresh.at, 1, wrapper);
      this.steps.push({ op: "wrap", parent: fresh.parent, at: fresh.at, wrapper });
    }
    return this.region;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    for (const s of [...this.steps].reverse()) {
      if (s.op === "removeControl") s.measure.children.splice(s.at, 0, s.el);
      else if (s.op === "addControl") {
        const i = s.measure.children.indexOf(s.el);
        if (i >= 0) s.measure.children.splice(i, 1);
      } else if (s.op === "wrap") {
        s.parent.children.splice(s.at, 1, ...s.wrapper.children);
      } else {
        s.parent.children.splice(s.at, s.wrapper.children.length, s.wrapper);
      }
    }
    return this.region;
  }
}

/**
 * Cycle a two-note pair (different pitches, adjacent, same container) into
 * grace + main: none → acciaccatura (slashed) → appoggiatura → none. The
 * grace note keeps its written duration but counts zero time, so its time
 * FOLDS into the main note (like a merge); un-gracing gives it back. The
 * fold requires the sum / difference to be one written duration.
 */
export class ToggleGraceCommand implements Command {
  readonly label = "cycle grace note";
  private mementos: { el: CoreElement; before: Record<string, string> }[] = [];
  private region: DirtyRegion[] = [];

  constructor(
    private readonly firstId: string,
    private readonly secondId: string,
  ) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    this.mementos = [];
    const a = ctx.index.byId.get(this.firstId);
    const b = ctx.index.byId.get(this.secondId);
    if (!a || !b) throw new Error("grace pair not found");
    if (a.measureIndex !== b.measureIndex || a.staffN !== b.staffN || a.layerN !== b.layerN) throw new Error("grace pair must sit in one measure, staff, and voice");
    const measure = ctx.score.measures[a.measureIndex]!;
    const h1 = locateWithParent(measure, this.firstId);
    const h2 = locateWithParent(measure, this.secondId);
    if (!h1 || !h2) throw new Error("grace pair not found");
    if (h1.parent !== h2.parent || h2.at !== h1.at + 1) throw new Error("grace pair must be adjacent notes");
    if (h1.el.tag !== "note" || h2.el.tag !== "note") throw new Error("grace pairs are single notes");
    this.region = [{ measureIndex: a.measureIndex, staffN: a.staffN }];
    const grace = h1.el;
    const main = h2.el;
    this.mementos.push({ el: grace, before: { ...grace.attrs } }, { el: main, before: { ...main.attrs } });
    const written = (el: CoreElement): Fraction => {
      const base = el.attrs["dur"] === "breve" ? frac(2, 1) : frac(1, Number(el.attrs["dur"]));
      const dots = Number(el.attrs["dots"] ?? "0");
      return { num: base.num * (2 ** (dots + 1) - 1), den: base.den * 2 ** dots };
    };
    const asSingle = (v: Fraction, what: string): { dur: string; dots?: number } => {
      if (v.num <= 0) throw new Error(`${what}: nothing left for the main note`);
      const parts = decomposeDuration(v);
      if (parts.length !== 1) throw new Error(`${what}: not one written duration`);
      return parts[0]!;
    };
    const state = grace.attrs["grace"] === "unacc" ? "unacc" : grace.attrs["grace"] === "acc" ? "acc" : "none";
    if (state === "none") {
      const sum = asSingle(fAdd(written(grace), written(main)), "grace fold");
      main.attrs["dur"] = sum.dur;
      if (sum.dots) main.attrs["dots"] = String(sum.dots);
      else delete main.attrs["dots"];
      grace.attrs["grace"] = "unacc";
      grace.attrs["stem.mod"] = "1slash";
    } else if (state === "unacc") {
      grace.attrs["grace"] = "acc";
      delete grace.attrs["stem.mod"];
    } else {
      const rest = asSingle(fAdd(written(main), { num: -written(grace).num, den: written(grace).den }), "grace unfold");
      main.attrs["dur"] = rest.dur;
      if (rest.dots) main.attrs["dots"] = String(rest.dots);
      else delete main.attrs["dots"];
      delete grace.attrs["grace"];
      delete grace.attrs["stem.mod"];
    }
    return this.region;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    for (const m of [...this.mementos].reverse()) m.el.attrs = { ...m.before };
    return this.region;
  }
}

/**
 * Toggle a pedal line over [startId, endId]: <pedal dir="down"> at the
 * start, <pedal dir="up"> at the end — each anchored in its own measure.
 */
export class TogglePedalCommand implements Command {
  readonly label = "toggle pedal";
  private removed: { measure: CoreElement; at: number; el: CoreElement }[] = [];
  private added: { measure: CoreElement; el: CoreElement }[] = [];
  private region: DirtyRegion[] = [];

  constructor(
    private readonly startId: string,
    private readonly endId: string,
  ) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    this.removed = [];
    this.added = [];
    const deref = (v: string | undefined) => (v ? v.replace(/^#/, "") : undefined);
    let a = ctx.index.byId.get(this.startId);
    let b = ctx.index.byId.get(this.endId);
    if (!a || !b) throw new Error("pedal endpoints not found");
    if (a.id === b.id) throw new Error("a pedal needs two different events");
    if (a.staffN !== b.staffN) throw new Error("pedal endpoints must share a staff");
    if (a.measureIndex > b.measureIndex || (a.measureIndex === b.measureIndex && a.eventIndex > b.eventIndex)) [a, b] = [b, a];
    this.region = [];
    for (let m = a.measureIndex; m <= b.measureIndex; m++) this.region.push({ measureIndex: m, staffN: a.staffN });
    const mA = ctx.score.measures[a.measureIndex]!;
    const mB = ctx.score.measures[b.measureIndex]!;
    const down = childElements(mA).find((c) => c.tag === "pedal" && c.attrs["dir"] === "down" && deref(c.attrs["startid"]) === a!.id) ?? null;
    if (down) {
      const up = childElements(mB).find((c) => c.tag === "pedal" && c.attrs["dir"] === "up" && deref(c.attrs["startid"]) === b!.id) ?? null;
      for (const [measure, el] of [[mA, down], [mB, up]] as const) {
        if (!el) continue;
        const at = measure.children.indexOf(el);
        measure.children.splice(at, 1);
        this.removed.push({ measure, at, el });
      }
    } else {
      for (const [measure, id, dir] of [[mA, a.id, "down"], [mB, b.id, "up"]] as const) {
        const el: CoreElement = { tag: "pedal", attrs: { "xml:id": newId(), staff: String(a.staffN), startid: `#${id}`, dir }, children: [] };
        measure.children.push(el);
        this.added.push({ measure, el });
      }
    }
    return this.region;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    for (const ad of [...this.added].reverse()) {
      const i = ad.measure.children.indexOf(ad.el);
      if (i >= 0) ad.measure.children.splice(i, 1);
    }
    for (const r of [...this.removed].reverse()) r.measure.children.splice(r.at, 0, r.el);
    return this.region;
  }
}

/**
 * Simile: replace one BEAT at the target with <beatRpt/> (the slash),
 * consuming events exactly like overwrite entry; on a beatRpt target the
 * toggle turns it back into a one-beat rest. The duration model treats
 * beatRpt as an unresolved beat (validation skips such layers).
 */
export class BeatRepeatCommand implements Command {
  readonly label = "toggle simile";
  private memento: SpliceMemento | null = null;
  private region: DirtyRegion[] = [];

  constructor(
    private readonly targetId: string,
    private readonly beat: Fraction,
    private readonly unitDur: string,
    private readonly capacity: Fraction,
  ) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    const ref = ctx.index.byId.get(this.targetId);
    if (!ref) throw new Error("simile target not found");
    const measure = ctx.score.measures[ref.measureIndex];
    const hit = measure && locateWithParent(measure, this.targetId);
    if (!hit) throw new Error("simile target not in measure");
    this.region = [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
    if (hit.el.tag === "beatRpt") {
      const rest: CoreElement = { tag: "rest", attrs: { "xml:id": newId(), dur: this.unitDur }, children: [] };
      hit.parent.children.splice(hit.at, 1, rest);
      this.memento = { parent: hit.parent, at: hit.at, removed: [hit.el], inserted: [rest] };
      return this.region;
    }
    const targetDur = hit.el.tag === "mRest" || hit.el.tag === "mSpace" || hit.el.tag === "mRpt" || hit.el.tag === "mRpt2" ? this.capacity : eventDuration(hit.el);
    if (targetDur === null) throw new Error("cannot read the target's duration");
    const removed: CoreElement[] = [hit.el];
    let covered = targetDur;
    let cursor = hit.at + 1;
    while (fCmp(covered, this.beat) < 0) {
      const next = hit.parent.children[cursor];
      if (next === undefined || typeof next === "string" || !EVENT_TAGS.has(next.tag)) {
        throw new Error("simile crosses a beam/tuplet/measure boundary");
      }
      const d = eventDuration(next);
      if (d === null) throw new Error("cannot consume an event of unknown duration");
      removed.push(next);
      covered = fAdd(covered, d);
      cursor++;
    }
    const remainder = fAdd(covered, { num: -this.beat.num, den: this.beat.den });
    const beatRpt: CoreElement = { tag: "beatRpt", attrs: { "xml:id": newId() }, children: [] };
    const inserted = [beatRpt, ...makeRests(remainder)];
    hit.parent.children.splice(hit.at, removed.length, ...inserted);
    this.memento = { parent: hit.parent, at: hit.at, removed, inserted };
    return this.region;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const m = this.memento;
    m.parent.children.splice(m.at, m.inserted.length, ...m.removed);
    return this.region;
  }
}

/**
 * Measure-repeat cycle at (measure, staff, voice): content → % (mRpt) →
 * %% (mRpt2, claiming the NEXT measure with an mSpace) → empty (mRest).
 * The original content comes back with undo, not by cycling.
 */
export class MeasureRepeatCycleCommand implements Command {
  readonly label = "cycle measure repeat";
  private mementos: { layer: CoreElement; before: (CoreElement | string)[] }[] = [];
  private region: DirtyRegion[] = [];

  constructor(
    private readonly measureIndex: number,
    private readonly staffN: number,
    private readonly layerN: number,
  ) {}

  private layerAt(ctx: CommandContext, m: number): CoreElement | null {
    const measure = ctx.score.measures[m];
    if (!measure) return null;
    const staff = childElements(measure).find((c) => c.tag === "staff" && Number(c.attrs["n"] ?? "1") === this.staffN);
    if (!staff) return null;
    return childElements(staff).find((c) => c.tag === "layer" && Number(c.attrs["n"] ?? "1") === this.layerN) ?? null;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    this.mementos = [];
    const layer = this.layerAt(ctx, this.measureIndex);
    if (!layer) throw new Error("no voice here for a measure repeat");
    const swap = (l: CoreElement, tag: string) => {
      this.mementos.push({ layer: l, before: l.children });
      l.children = [{ tag, attrs: { "xml:id": newId() }, children: [] }];
    };
    const kids = childElements(layer);
    const single = kids.length === 1 ? kids[0]!.tag : "";
    this.region = [{ measureIndex: this.measureIndex, staffN: this.staffN }];
    if (single === "mRpt") {
      const next = this.layerAt(ctx, this.measureIndex + 1);
      if (!next) throw new Error("%% needs a following measure with this voice");
      swap(layer, "mRpt2");
      swap(next, "mSpace");
      this.region.push({ measureIndex: this.measureIndex + 1, staffN: this.staffN });
    } else if (single === "mRpt2") {
      swap(layer, "mRest");
      const next = this.layerAt(ctx, this.measureIndex + 1);
      const nextKids = next ? childElements(next) : [];
      if (next && nextKids.length === 1 && nextKids[0]!.tag === "mSpace") {
        swap(next, "mRest");
        this.region.push({ measureIndex: this.measureIndex + 1, staffN: this.staffN });
      }
    } else {
      swap(layer, "mRpt");
    }
    return this.region;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    for (const m of [...this.mementos].reverse()) m.layer.children = m.before;
    return this.region;
  }
}

/**
 * Tuplets from a selection: 3 events → triplet (3:2), 6 → sextuplet (6:4).
 * Wrapping shrinks the run to numbase/num of its written time, so the
 * freed time becomes rests AFTER the tuplet (duration invariant intact);
 * a selection inside an existing tuplet unwraps it, consuming those rests
 * back. Refuses runs whose freed time is not expressible as rests
 * (mixed-duration corner cases) and unwraps without enough rests after.
 */
export class TupletCommand implements Command {
  readonly label = "toggle tuplet";
  private memento: SpliceMemento | null = null;
  private region: DirtyRegion[] = [];

  constructor(private readonly ids: string[]) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    if (this.ids.length === 0) throw new Error("nothing selected");
    const refs = this.ids.map((id) => {
      const r = ctx.index.byId.get(id);
      if (!r) throw new Error("tuplet target not found");
      return r;
    });
    const first = refs[0]!;
    if (!refs.every((r) => r.measureIndex === first.measureIndex && r.staffN === first.staffN && r.layerN === first.layerN)) {
      throw new Error("a tuplet lives in one measure, staff, and voice");
    }
    const measure = ctx.score.measures[first.measureIndex]!;
    const hits = this.ids.map((id) => {
      const h = locateWithParent(measure, id);
      if (!h) throw new Error("tuplet target not in measure");
      return h;
    });
    this.region = [{ measureIndex: first.measureIndex, staffN: first.staffN }];
    const parent = hits[0]!.parent;

    if (parent.tag === "tuplet") {
      // ---- unwrap ----
      const tupletHit = locateWithParent(measure, parent.attrs["xml:id"] ?? "");
      if (!tupletHit) throw new Error("tuplet wrapper not found");
      const num = Number(parent.attrs["num"] ?? "3");
      const numbase = Number(parent.attrs["numbase"] ?? "2");
      const events = childElements(parent).filter((c) => EVENT_TAGS.has(c.tag));
      let written = frac(0, 1);
      for (const e of events) {
        const d = eventDuration(e);
        if (d === null) throw new Error("cannot read a tuplet member's duration");
        written = fAdd(written, d);
      }
      const occupies = fMul(written, frac(numbase, num));
      let extra = fAdd(written, { num: -occupies.num, den: occupies.den });
      // consume following RESTS in the tuplet's container for the growth
      const removed: CoreElement[] = [tupletHit.el];
      let cursor = tupletHit.at + 1;
      while (fCmp(extra, frac(0, 1)) > 0) {
        const next = tupletHit.parent.children[cursor];
        if (next === undefined || typeof next === "string" || next.tag !== "rest") {
          throw new Error("unwrapping needs the tuplet's freed time back as rests after it");
        }
        const d = eventDuration(next);
        if (d === null) throw new Error("cannot consume a rest of unknown duration");
        removed.push(next);
        extra = fAdd(extra, { num: -d.num, den: d.den });
        cursor++;
      }
      // extra <= 0: overshoot becomes rests again after the unwrapped run
      const overshoot = { num: -extra.num, den: extra.den };
      const inserted = [...parent.children.filter((c): c is CoreElement => typeof c !== "string"), ...makeRests(overshoot)];
      tupletHit.parent.children.splice(tupletHit.at, removed.length, ...inserted);
      this.memento = { parent: tupletHit.parent, at: tupletHit.at, removed, inserted };
      return this.region;
    }

    // ---- wrap ----
    if (!hits.every((h) => h.parent === parent)) throw new Error("tuplet members must share a container");
    const sorted = [...hits].sort((a, b) => a.at - b.at);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.at !== sorted[0]!.at + i) throw new Error("tuplet members must be consecutive");
    }
    const ratio = this.ids.length === 3 ? { num: 3, numbase: 2 } : this.ids.length === 6 ? { num: 6, numbase: 4 } : null;
    if (!ratio) throw new Error("select 3 notes for a triplet or 6 for a sextuplet");
    let written = frac(0, 1);
    for (const h of sorted) {
      const d = eventDuration(h.el);
      if (d === null) throw new Error("tuplet members need written durations");
      written = fAdd(written, d);
    }
    const freed = fMul(written, frac(ratio.num - ratio.numbase, ratio.num));
    let rests: CoreElement[];
    try {
      rests = makeRests(freed);
    } catch {
      throw new Error("this run's freed time cannot be written as rests — use equal durations");
    }
    const members = sorted.map((h) => h.el);
    const tuplet: CoreElement = { tag: "tuplet", attrs: { "xml:id": newId(), num: String(ratio.num), numbase: String(ratio.numbase) }, children: members };
    const inserted = [tuplet, ...rests];
    parent.children.splice(sorted[0]!.at, members.length, ...inserted);
    this.memento = { parent, at: sorted[0]!.at, removed: members, inserted };
    return this.region;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    const m = this.memento;
    m.parent.children.splice(m.at, m.inserted.length, ...m.removed);
    return this.region;
  }
}

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
    // Softest to loudest, then off: none -> p -> mp -> mf -> f -> none.
    const NEXT: Record<string, string> = { p: "mp", mp: "mf", mf: "f" };
    if (!existing) {
      const dynam: CoreElement = { tag: "dynam", attrs: { "xml:id": newId(), staff: String(ref.staffN), startid: `#${this.targetId}` }, children: ["p"] };
      measure.children.push(dynam);
      this.memento = { measure, at: measure.children.length - 1, before: null, after: dynam };
    } else if (typeof value === "string" && NEXT[value]) {
      const at = measure.children.indexOf(existing);
      const next: CoreElement = { ...existing, attrs: { ...existing.attrs }, children: [NEXT[value]!] };
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
