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
import { SetPitchesCommand, SetSylCommand, type Command } from "@battuta/core";

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
    default: {
      const unknown = message as { type?: unknown };
      throw new Error(`unknown command message type ${JSON.stringify(unknown.type)}`);
    }
  }
}
