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
import type { CommandMessage } from "@battuta/api";
import { AddChordNoteCommand, frac, measuresOf, meterCapacity, ReplaceEntryCommand, resolveContexts, SetHarmCommand, SetPitchesCommand, SetSylCommand, UnbeamThen, type Command, type CommandContext, type DirtyRegion, type EntrySpec } from "@battuta/core";

const DURATIONS = ["1", "2", "4", "8", "16", "32", "64"];

/** A note length, checked at the door: `core.enterNote`'s and `ctx.setEntryLength`'s. */
export function checkLength(where: string, dur: unknown, dots: unknown): void {
  if (!DURATIONS.includes(dur as string)) throw new Error(`${where}: dur must be one of ${DURATIONS.join(", ")} (got ${JSON.stringify(dur)})`);
  if (!Number.isInteger(dots) || (dots as number) < 0 || (dots as number) > 2) throw new Error(`${where}: dots must be 0, 1 or 2 (got ${JSON.stringify(dots)})`);
}

/**
 * `core.enterNote` (1.3.0): the keyboard's overwrite entry — the session's
 * `enterEvent` — built when it first runs, so the mapping needs no session:
 * the measure's capacity (for a measure rest) and the unbeam wrap are read
 * off the document it runs against. Redo re-applies the same entry.
 */
class EnterNoteCommand implements Command {
  readonly label: string;
  private inner: Command | null = null;
  private entry: ReplaceEntryCommand | null = null;

  constructor(
    private readonly targetId: string,
    private readonly spec: EntrySpec,
  ) {
    this.label = `enter note ${spec.pname}${spec.dur}${".".repeat(spec.dots ?? 0)}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    if (!this.inner) {
      const ref = ctx.index.byId.get(this.targetId);
      if (!ref) throw new Error(`core.enterNote: no event ${JSON.stringify(this.targetId)}`);
      const capacity = meterCapacity(resolveContexts(ctx.score)[ref.measureIndex]?.get(ref.staffN)?.meter ?? {}) || frac(4, 4);
      this.entry = new ReplaceEntryCommand(this.targetId, this.spec, capacity);
      this.inner = new UnbeamThen(this.entry, measuresOf(ctx.score, ctx.index, [this.targetId]));
    }
    return this.inner.apply(ctx);
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    return this.inner ? this.inner.revert(ctx) : [];
  }

  /** The note the entry wrote, once applied. */
  get writtenId(): string | null {
    return this.entry?.enteredId ?? null;
  }
}

/**
 * The event a message's command wrote, once it ran — the note entered, the
 * chord grown — where the caret goes (1.3.3, the stylus); null for every
 * other message.
 */
export function writtenBy(cmd: Command): string | null {
  return cmd instanceof EnterNoteCommand ? cmd.writtenId : cmd instanceof AddChordNoteCommand ? cmd.resultId : null;
}

/** A written pitch, checked at the door: a letter and an octave. */
function checkPitch(m: { type: string; pname: unknown; oct: unknown }): void {
  if (typeof m.pname !== "string" || !/^[a-g]$/.test(m.pname)) throw new Error(`${m.type}: pname must be a letter a–g (got ${JSON.stringify(m.pname)})`);
  if (!Number.isInteger(m.oct) || (m.oct as number) < 0 || (m.oct as number) > 9) throw new Error(`${m.type}: oct must be an integer 0–9 (got ${JSON.stringify(m.oct)})`);
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
      return new EnterNoteCommand(String(message.eventId), { kind: "note", pname: message.pname, oct: message.oct, dur: message.dur, ...(dots > 0 && { dots }) });
    }
    case "core.addChordNote": {
      checkPitch(message);
      return new AddChordNoteCommand(String(message.eventId), message.pname, message.oct);
    }
    default: {
      const unknown = message as { type?: unknown };
      throw new Error(`unknown command message type ${JSON.stringify(unknown.type)}`);
    }
  }
}
