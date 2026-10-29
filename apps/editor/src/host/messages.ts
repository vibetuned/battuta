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
import { frac, measuresOf, meterCapacity, ReplaceEntryCommand, resolveContexts, SetHarmCommand, SetPitchesCommand, SetSylCommand, UnbeamThen, type Command, type CommandContext, type DirtyRegion, type EntrySpec } from "@battuta/core";

const DURATIONS = ["1", "2", "4", "8", "16", "32", "64"];

/**
 * `core.enterNote` (1.3.0): the keyboard's overwrite entry — the session's
 * `enterEvent` — built when it first runs, so the mapping needs no session:
 * the measure's capacity (for a measure rest) and the unbeam wrap are read
 * off the document it runs against. Redo re-applies the same entry.
 */
class EnterNoteCommand implements Command {
  readonly label: string;
  private inner: Command | null = null;

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
      this.inner = new UnbeamThen(new ReplaceEntryCommand(this.targetId, this.spec, capacity), measuresOf(ctx.score, ctx.index, [this.targetId]));
    }
    return this.inner.apply(ctx);
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    return this.inner ? this.inner.revert(ctx) : [];
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
      if (typeof message.pname !== "string" || !/^[a-g]$/.test(message.pname)) throw new Error(`core.enterNote: pname must be a letter a–g (got ${JSON.stringify(message.pname)})`);
      if (!Number.isInteger(message.oct) || message.oct < 0 || message.oct > 9) throw new Error(`core.enterNote: oct must be an integer 0–9 (got ${JSON.stringify(message.oct)})`);
      if (!DURATIONS.includes(message.dur)) throw new Error(`core.enterNote: dur must be one of ${DURATIONS.join(", ")} (got ${JSON.stringify(message.dur)})`);
      const dots = message.dots ?? 0;
      if (!Number.isInteger(dots) || dots < 0 || dots > 2) throw new Error(`core.enterNote: dots must be 0, 1 or 2 (got ${JSON.stringify(message.dots)})`);
      return new EnterNoteCommand(String(message.eventId), { kind: "note", pname: message.pname, oct: message.oct, dur: message.dur, ...(dots > 0 && { dots }) });
    }
    default: {
      const unknown = message as { type?: unknown };
      throw new Error(`unknown command message type ${JSON.stringify(unknown.type)}`);
    }
  }
}
