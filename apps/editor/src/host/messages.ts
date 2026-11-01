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
import { AddChordNoteCommand, ChangeContextCommand, ChangeDurationCommand, findAll, frac, measuresOf, meterCapacity, ReplaceEntryCommand, resolveContexts, SetHarmCommand, SetPitchesCommand, SetSylCommand, ToggleAccidentalCommand, ToggleArticCommand, ToggleDynamCommand, ToggleFingCommand, ToggleMarkCommand, TogglePedalCommand, UnbeamThen, type ClefSpec, type Command, type CommandContext, type DirtyRegion, type EntrySpec } from "@battuta/core";

const DURATIONS = ["1", "2", "4", "8", "16", "32", "64"];

/** A note length, checked at the door: `core.enterNote`'s and `ctx.setEntryLength`'s. */
export function checkLength(where: string, dur: unknown, dots: unknown): void {
  if (!DURATIONS.includes(dur as string)) throw new Error(`${where}: dur must be one of ${DURATIONS.join(", ")} (got ${JSON.stringify(dur)})`);
  if (!Number.isInteger(dots) || (dots as number) < 0 || (dots as number) > 2) throw new Error(`${where}: dots must be 0, 1 or 2 (got ${JSON.stringify(dots)})`);
}

/** The event a message names, off the document it runs against. */
function eventOf(where: string, ctx: CommandContext, id: string) {
  const ref = ctx.index.byId.get(id);
  if (!ref) throw new Error(`${where}: no event ${JSON.stringify(id)}`);
  return ref;
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

/**
 * `core.mark` (1.3.5): one of the keyboard's marks on an event, built when
 * it first runs — the dot and the clef read the document: the event's
 * written duration, its measure and staff. The caret goes to the event.
 */
class MarkCommand implements Command {
  readonly label: string;
  private inner: Command | null = null;

  constructor(
    private readonly eventId: string,
    private readonly mark: Exclude<Mark, { kind: "rest" }>,
  ) {
    const m = mark;
    this.label =
      m.kind === "accidental" ? ACCIDENTAL_NAMES[m.accid]! : m.kind === "articulation" ? ARTIC_NAMES[m.artic]! : m.kind === "dynamic" ? `dynamic ${m.value}` : m.kind === "fingering" ? `fingering ${m.finger}` : m.kind === "clef" ? `clef ${m.shape}` : m.kind;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    this.inner ??= this.build(ctx);
    return this.inner.apply(ctx);
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    return this.inner ? this.inner.revert(ctx) : [];
  }

  /** The event the mark went on: where the caret goes. */
  get writtenId(): string {
    return this.eventId;
  }

  private build(ctx: CommandContext): Command {
    const id = this.eventId;
    const m = this.mark;
    switch (m.kind) {
      case "accidental":
        return new ToggleAccidentalCommand([id], m.accid);
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
 * The event a message's command wrote, once it ran — the note entered, the
 * chord grown, the event marked — where the caret goes (1.3.3, the stylus);
 * null for every other message.
 */
export function writtenBy(cmd: Command): string | null {
  return cmd instanceof EntryCommand ? cmd.writtenId : cmd instanceof AddChordNoteCommand ? cmd.resultId : cmd instanceof MarkCommand ? cmd.writtenId : null;
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
  const m = (mark ?? {}) as { kind?: unknown; accid?: unknown; artic?: unknown; value?: unknown; finger?: unknown; endId?: unknown; shape?: unknown; dur?: unknown; dots?: unknown };
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
    case "dynamic":
      if (typeof m.value !== "string" || !/^[a-z]{1,4}$/.test(m.value)) throw new Error(`core.mark: a dynamic's value is one to four letters (got ${JSON.stringify(m.value)})`);
      return { kind: "dynamic", value: m.value };
    case "fingering":
      return { kind: "fingering", finger: ONE_OF("core.mark", "finger", m.finger, ["1", "2", "3", "4", "5"]) as "1" | "2" | "3" | "4" | "5" };
    case "clef":
      return { kind: "clef", shape: ONE_OF("core.mark", "shape", m.shape, ["G", "F", "C"]) as "G" | "F" | "C" };
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
    default: {
      const unknown = message as { type?: unknown };
      throw new Error(`unknown command message type ${JSON.stringify(unknown.type)}`);
    }
  }
}
