/**
 * Command messages → core commands. The host's half of "commands as
 * data": a plugin sends `{ type, ...fields }` through `ctx.execute`, and
 * this is the only place that knows which core Command that means. Data
 * is copied before it reaches a command, so a plugin holding on to its
 * message objects cannot reach into a memento.
 *
 * Adding a message: a case here, a member of the union in
 * `packages/api/src/messages.ts`, a mapping test in `test/host.test.ts`,
 * and an API version bump.
 */
import type { CommandMessage, Mark } from "@battuta/api";
import { AddChordNoteCommand, InsertMeasuresCommand, ChainTieCommand, ChangeContextCommand, ChangeDurationCommand, ChordNoteAccidentalCommand, DeleteToRestsCommand, findAll, frac, measuresOf, meterCapacity, OrnamentCycleCommand, RemoveControlCommand, ReplaceEntryCommand, resolveContexts, SetHarmCommand, SetPitchesCommand, SetSylCommand, ToggleAccidentalCommand, ToggleArticCommand, ToggleDynamCommand, ToggleFingCommand, ToggleMarkCommand, TogglePedalCommand, ToggleSlurCommand, ToggleTieCommand, UnbeamThen, type ClefSpec, type Command, type CommandContext, type DirtyRegion, type EntrySpec } from "@battuta/core";

const DURATIONS = ["1", "2", "4", "8", "16", "32", "64"];

/** A note length, checked at the door: `core.enterNote`'s and `ctx.setEntryLength`'s. */
export function checkLength(where: string, dur: unknown, dots: unknown): void {
  if (!DURATIONS.includes(dur as string)) throw new Error(`${where}: dur must be one of ${DURATIONS.join(", ")} (got ${JSON.stringify(dur)})`);
  if (!Number.isInteger(dots) || (dots as number) < 0 || (dots as number) > 2) throw new Error(`${where}: dots must be 0, 1 or 2 (got ${JSON.stringify(dots)})`);
}

/** The event a message names, off the document it runs against. */
/** The chord a note belongs to, when `id` names a chord's note — not in the event index, though the pen's `nearestNote` names them; null otherwise. */
function chordOf(ctx: CommandContext, id: string): string | null {
  for (const measure of ctx.score.measures) {
    for (const chord of findAll(measure, "chord")) {
      if (chord.children.some((c) => typeof c !== "string" && c.attrs["xml:id"] === id)) return chord.attrs["xml:id"] ?? null;
    }
  }
  return null;
}

/** The event `id` names — the chord, for a chord's note. */
function eventOf(where: string, ctx: CommandContext, id: string) {
  const ref = ctx.index.byId.get(id) ?? ctx.index.byId.get(chordOf(ctx, id) ?? "");
  if (!ref) throw new Error(`${where}: no event ${JSON.stringify(id)}`);
  return ref;
}

/** Two events in document order — the chord, for a chord's note; never the same one twice (1.3.9, a tie or a slur drawn either way). */
function orderedPair(ctx: CommandContext, a: string, b: string): [string, string] {
  const ra = eventOf("core.mark", ctx, a), rb = eventOf("core.mark", ctx, b);
  if (ra.id === rb.id) throw new Error("core.mark: a tie or a slur goes from one event to another");
  const before = ra.measureIndex !== rb.measureIndex ? ra.measureIndex < rb.measureIndex : ra.staffN !== rb.staffN ? ra.staffN < rb.staffN : ra.layerN !== rb.layerN ? ra.layerN < rb.layerN : ra.eventIndex < rb.eventIndex;
  return before ? [ra.id, rb.id] : [rb.id, ra.id];
}

/** The events from one to the other in their layer, both included: what a tie links, as the key's chain over a run. */
function runBetween(ctx: CommandContext, a: string, b: string): string[] {
  const [first, last] = orderedPair(ctx, a, b);
  const ra = ctx.index.byId.get(first)!, rb = ctx.index.byId.get(last)!;
  if (ra.staffN !== rb.staffN || ra.layerN !== rb.layerN) throw new Error("core.mark: a tie stays in one staff and layer");
  const ids: string[] = [];
  for (let m = ra.measureIndex; m <= rb.measureIndex; m++) {
    const layer = ctx.index.eventsAt(m, ra.staffN, ra.layerN);
    const from = m === ra.measureIndex ? ra.eventIndex : 0;
    const to = m === rb.measureIndex ? rb.eventIndex : layer.length - 1;
    for (let i = from; i <= to; i++) ids.push(layer[i]!);
  }
  return ids;
}

/** The measure's capacity at an event — what a measure rest is worth. */
function capacityAt(ctx: CommandContext, ref: { measureIndex: number; staffN: number }) {
  return meterCapacity(resolveContexts(ctx.score)[ref.measureIndex]?.get(ref.staffN)?.meter ?? {}) || frac(4, 4);
}

/**
 * `core.enterNote` (1.3.0) and `core.mark`'s rest (1.3.5): the keyboard's
 * overwrite entry — the session's `enterEvent` — built when it first runs,
 * so the mapping needs no session: the measure's capacity (for a measure
 * rest) and the unbeam wrap are read off the document it runs against.
 * Redo re-applies the same entry.
 */
class EntryCommand implements Command {
  readonly label: string;
  private inner: Command | null = null;
  private entry: ReplaceEntryCommand | null = null;

  constructor(
    private readonly type: string,
    private readonly targetId: string,
    private readonly spec: EntrySpec,
  ) {
    const dots = ".".repeat(spec.dots ?? 0);
    this.label = spec.kind === "note" ? `enter note ${spec.pname}${spec.dur}${dots}` : `enter rest ${spec.dur}${dots}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    if (!this.inner) {
      const ref = eventOf(this.type, ctx, this.targetId);
      this.entry = new ReplaceEntryCommand(this.targetId, this.spec, capacityAt(ctx, ref));
      this.inner = new UnbeamThen(this.entry, measuresOf(ctx.score, ctx.index, [this.targetId]));
    }
    return this.inner.apply(ctx);
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    return this.inner ? this.inner.revert(ctx) : [];
  }

  /** The event the entry wrote, once applied. */
  get writtenId(): string | null {
    return this.entry?.enteredId ?? null;
  }
}

/** The clef each shape names, as the keyboard's context bar offers them. */
const CLEFS: Record<"G" | "F" | "C", ClefSpec> = { G: { shape: "G", line: 2 }, F: { shape: "F", line: 4 }, C: { shape: "C", line: 3 } };

const ACCIDENTAL_NAMES: Record<string, string> = { s: "sharp", f: "flat", n: "natural", x: "double sharp" };
const ARTIC_NAMES: Record<string, string> = { stacc: "staccato", ten: "tenuto", acc: "accent", stacciss: "staccatissimo", marc: "marcato" };

const ORNAMENT_NAMES: Record<string, string> = { arpeg: "arpeggio", trill: "trill", mordent: "mordent", turn: "turn" };
const REPEAT_MARK_NAMES: Record<string, string> = { coda: "coda", toCoda: "To Coda", segno: "segno", fine: "Fine", dalSegno: "D.S.", daCapo: "D.C." };

/**
 * `core.mark` (1.3.5): one of the keyboard's marks on an event, built when
 * it first runs — the dot and the clef read the document: the event's
 * written duration, its measure and staff. A chord's note names its chord
 * (the accidental alone stays the note's). The caret goes to the event.
 */
class MarkCommand implements Command {
  readonly label: string;
  private inner: Command | null = null;
  private target: string;

  constructor(
    private readonly eventId: string,
    private readonly mark: Exclude<Mark, { kind: "rest" }>,
  ) {
    const m = mark;
    this.target = eventId;
    this.label =
      m.kind === "accidental" ? ACCIDENTAL_NAMES[m.accid]! : m.kind === "articulation" ? ARTIC_NAMES[m.artic]! : m.kind === "dynamic" ? `dynamic ${m.value}` : m.kind === "fingering" ? `fingering ${m.finger}` : m.kind === "clef" ? `clef ${m.shape}` : m.kind === "ornament" ? ORNAMENT_NAMES[m.ornament]! : m.kind === "repeatMark" ? REPEAT_MARK_NAMES[m.mark]! : m.kind;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    this.inner ??= this.build(ctx);
    return this.inner.apply(ctx);
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    return this.inner ? this.inner.revert(ctx) : [];
  }

  /** The event the mark went on — the chord, for a chord's note: where the caret goes. */
  get writtenId(): string {
    return this.target;
  }

  private build(ctx: CommandContext): Command {
    const m = this.mark;
    const chord = ctx.index.byId.has(this.eventId) ? null : chordOf(ctx, this.eventId);
    if (m.kind === "accidental") return chord ? new ChordNoteAccidentalCommand(chord, this.eventId, m.accid) : new ToggleAccidentalCommand([this.eventId], m.accid);
    const id = chord ?? this.eventId;
    this.target = id;
    switch (m.kind) {
      case "articulation":
        return new ToggleArticCommand([id], m.artic);
      case "fermata":
        return new ToggleMarkCommand(id, "fermata");
      case "dynamic":
        return new ToggleDynamCommand(id, m.value);
      case "fingering":
        return new ToggleFingCommand(id, m.finger, false);
      case "pedal":
        return new TogglePedalCommand(id, m.endId);
      case "ornament":
        return new OrnamentCycleCommand(id, m.ornament);
      case "repeatMark":
        return new ToggleMarkCommand(id, "coda", m.mark);
      case "tie": {
        // Neighbours: the key's tie; further apart: its chain over the run, every event a link.
        const run = runBetween(ctx, id, m.endId);
        this.target = run[0]!;
        return run.length === 2 ? new ToggleTieCommand(run[0]!) : new ChainTieCommand(run);
      }
      case "slur": {
        const [first, last] = orderedPair(ctx, id, m.endId);
        this.target = first;
        return new ToggleSlurCommand(first, last);
      }
      case "dot": {
        // The session's toggleDot: the event re-entered in place with the dot flipped.
        const ref = eventOf("core.mark", ctx, id);
        if (ref.tag !== "note" && ref.tag !== "rest" && ref.tag !== "chord") throw new Error("core.mark: the dot goes on a note, rest or chord");
        const measure = ctx.score.measures[ref.measureIndex];
        const el = measure && findAll(measure, ref.tag).find((e) => e.attrs["xml:id"] === id);
        if (!el?.attrs["dur"]) throw new Error("core.mark: the dot's event has no written duration");
        return new UnbeamThen(new ChangeDurationCommand(id, el.attrs["dur"], el.attrs["dots"] ? 0 : 1, capacityAt(ctx, ref)), measuresOf(ctx.score, ctx.index, [id]));
      }
      case "clef": {
        const ref = eventOf("core.mark", ctx, id);
        return new ChangeContextCommand(ref.measureIndex, { clef: { ...CLEFS[m.shape] }, staffN: ref.staffN });
      }
    }
  }
}

/**
 * `core.erase` (1.3.7): a note or chord deleted to rests, as the Delete key
 * does it (a chord's note names its chord); a mark that stands on its own
 * removed by its id. Built when it first runs, from what the id names.
 */
class EraseCommand implements Command {
  readonly label = "erase";
  private inner: Command | null = null;
  private deleted: DeleteToRestsCommand | null = null;
  private removed: RemoveControlCommand | null = null;

  constructor(private readonly id: string) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    this.inner ??= this.build(ctx);
    return this.inner.apply(ctx);
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    return this.inner ? this.inner.revert(ctx) : [];
  }

  /** The rest that took the note's place, or the event the mark was on: where the caret goes. */
  get writtenId(): string | null {
    return this.deleted?.replacedBy[0] ?? this.removed?.startId ?? null;
  }

  private build(ctx: CommandContext): Command {
    const ref = ctx.index.byId.get(this.id) ?? ctx.index.byId.get(chordOf(ctx, this.id) ?? "");
    if (ref) {
      if (ref.tag !== "note" && ref.tag !== "chord") throw new Error(`core.erase: a ${ref.tag} is nothing to erase`);
      this.deleted = new DeleteToRestsCommand([ref.id]);
      return new UnbeamThen(this.deleted, measuresOf(ctx.score, ctx.index, [ref.id]));
    }
    this.removed = new RemoveControlCommand(this.id);
    return this.removed;
  }
}

/**
 * A measure after the last (`core.appendMeasure`, 1.3.12): the keyboard's
 * insert, at the end whatever the caret; the new measure's first rest is
 * what it "wrote", so the caret goes there.
 */
class AppendMeasureCommand implements Command {
  readonly label = "append a measure";
  private inner: InsertMeasuresCommand | null = null;
  private at = -1;
  writtenId: string | null = null;

  apply(ctx: CommandContext): DirtyRegion[] {
    if (!this.inner) {
      this.at = ctx.score.measures.length;
      this.inner = new InsertMeasuresCommand(this.at, 1);
    }
    const dirty = this.inner.apply(ctx);
    const measure = ctx.score.measures[this.at];
    const first = measure ? (findAll(measure, "mRest")[0] ?? findAll(measure, "rest")[0]) : undefined;
    this.writtenId = first?.attrs["xml:id"] ?? null;
    return dirty;
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    return this.inner ? this.inner.revert(ctx) : [];
  }
}

/**
 * The event a message's command wrote, once it ran — the note entered, the
 * chord grown, the event marked, the rest an erased note left — where the
 * caret goes (1.3.3, the stylus); null for every other message.
 */
export function writtenBy(cmd: Command): string | null {
  return cmd instanceof EntryCommand ? cmd.writtenId : cmd instanceof AddChordNoteCommand ? cmd.resultId : cmd instanceof MarkCommand ? cmd.writtenId : cmd instanceof EraseCommand ? cmd.writtenId : cmd instanceof AppendMeasureCommand ? cmd.writtenId : null;
}

/** A written pitch, checked at the door: a letter and an octave. */
function checkPitch(m: { type: string; pname: unknown; oct: unknown }): void {
  if (typeof m.pname !== "string" || !/^[a-g]$/.test(m.pname)) throw new Error(`${m.type}: pname must be a letter a–g (got ${JSON.stringify(m.pname)})`);
  if (!Number.isInteger(m.oct) || (m.oct as number) < 0 || (m.oct as number) > 9) throw new Error(`${m.type}: oct must be an integer 0–9 (got ${JSON.stringify(m.oct)})`);
}

const ONE_OF = (where: string, what: string, value: unknown, allowed: readonly string[]): string => {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${where}: ${what} must be one of ${allowed.join(", ")} (got ${JSON.stringify(value)})`);
  return value;
};

/** A mark, checked at the door and copied. */
function checkMark(mark: unknown): Mark {
  const m = (mark ?? {}) as { kind?: unknown; accid?: unknown; artic?: unknown; value?: unknown; finger?: unknown; endId?: unknown; shape?: unknown; dur?: unknown; dots?: unknown; ornament?: unknown; mark?: unknown };
  switch (m.kind) {
    case "accidental":
      return { kind: "accidental", accid: ONE_OF("core.mark", "accid", m.accid, ["s", "f", "n", "x"]) as "s" | "f" | "n" | "x" };
    case "articulation":
      return { kind: "articulation", artic: ONE_OF("core.mark", "artic", m.artic, ["stacc", "ten", "acc", "stacciss", "marc"]) as "stacc" | "ten" | "acc" | "stacciss" | "marc" };
    case "dot":
    case "fermata":
      return { kind: m.kind };
    case "pedal":
      if (typeof m.endId !== "string" || m.endId === "") throw new Error("core.mark: a pedal needs endId, the event it ends on");
      return { kind: "pedal", endId: m.endId };
    case "tie":
    case "slur":
      if (typeof m.endId !== "string" || m.endId === "") throw new Error(`core.mark: a ${m.kind} needs endId, the event it ends on`);
      return { kind: m.kind, endId: m.endId };
    case "dynamic":
      if (typeof m.value !== "string" || !/^[a-z]{1,4}$/.test(m.value)) throw new Error(`core.mark: a dynamic's value is one to four letters (got ${JSON.stringify(m.value)})`);
      return { kind: "dynamic", value: m.value };
    case "fingering":
      return { kind: "fingering", finger: ONE_OF("core.mark", "finger", m.finger, ["1", "2", "3", "4", "5"]) as "1" | "2" | "3" | "4" | "5" };
    case "clef":
      return { kind: "clef", shape: ONE_OF("core.mark", "shape", m.shape, ["G", "F", "C"]) as "G" | "F" | "C" };
    case "ornament":
      return { kind: "ornament", ornament: ONE_OF("core.mark", "ornament", m.ornament, ["arpeg", "trill", "mordent", "turn"]) as "arpeg" | "trill" | "mordent" | "turn" };
    case "repeatMark":
      return { kind: "repeatMark", mark: ONE_OF("core.mark", "mark", m.mark, ["coda", "toCoda", "segno", "fine", "dalSegno", "daCapo"]) as "coda" | "toCoda" | "segno" | "fine" | "dalSegno" | "daCapo" };
    case "rest": {
      const dots = m.dots ?? 0;
      checkLength("core.mark", m.dur, dots);
      return { kind: "rest", dur: m.dur as string, ...((dots as number) > 0 && { dots: dots as number }) };
    }
    default:
      throw new Error(`core.mark: unknown mark kind ${JSON.stringify(m.kind)}`);
  }
}

export function toCommand(message: CommandMessage): Command {
  switch (message.type) {
    case "core.setPitches": {
      if (!Array.isArray(message.targets)) throw new Error("core.setPitches: targets must be an array");
      const targets = message.targets.map((t) => ({ eventId: String(t.eventId), pitches: t.pitches.map((p) => ({ ...p })) }));
      return new SetPitchesCommand(targets, String(message.label ?? "plugin edit"));
    }
    case "core.setSyl": {
      const v = message.value as { text?: unknown; wordpos?: unknown; con?: unknown } | undefined;
      if (!v || typeof v.text !== "string") throw new Error("core.setSyl: value.text must be a string");
      return new SetSylCommand(String(message.eventId), {
        text: v.text,
        ...(typeof v.wordpos === "string" ? { wordpos: v.wordpos } : {}),
        ...(typeof v.con === "string" ? { con: v.con } : {}),
      });
    }
    case "core.setHarm": {
      if (message.kind !== "chord" && message.kind !== "rna") throw new Error(`core.setHarm: kind must be chord or rna (got ${JSON.stringify(message.kind)})`);
      if (typeof message.text !== "string") throw new Error("core.setHarm: text must be a string");
      return new SetHarmCommand(String(message.eventId), message.text, message.kind);
    }
    case "core.enterNote": {
      checkPitch(message);
      const dots = message.dots ?? 0;
      checkLength(message.type, message.dur, dots);
      return new EntryCommand(message.type, String(message.eventId), { kind: "note", pname: message.pname, oct: message.oct, dur: message.dur, ...(dots > 0 && { dots }) });
    }
    case "core.addChordNote": {
      checkPitch(message);
      return new AddChordNoteCommand(String(message.eventId), message.pname, message.oct);
    }
    case "core.mark": {
      const mark = checkMark(message.mark);
      if (mark.kind === "rest") return new EntryCommand(message.type, String(message.eventId), { kind: "rest", dur: mark.dur, ...(mark.dots && { dots: mark.dots }) });
      return new MarkCommand(String(message.eventId), mark);
    }
    case "core.erase": {
      if (typeof message.id !== "string" || message.id === "") throw new Error("core.erase: id must name a note, a chord or a mark");
      return new EraseCommand(message.id);
    }
    case "core.appendMeasure":
      return new AppendMeasureCommand();
    default: {
      const unknown = message as { type?: unknown };
      throw new Error(`unknown command message type ${JSON.stringify(unknown.type)}`);
    }
  }
}
