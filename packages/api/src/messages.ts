/**
 * Commands as data. A plugin mutates the document by handing the host a
 * serializable message; the host owns the mapping from message to the
 * real core command (`apps/editor/src/host/messages.ts`) and runs it as
 * one undo step. A plugin therefore cannot mutate in any way the host has
 * not published here — and cannot construct a command at all, because
 * `@battuta/core` is not reachable from a plugin package.
 *
 * Adding a message = one member of this union + one case in the host's
 * `toCommand` + a mapping test + an API version bump. Every planned slice
 * maps onto a command that already exists in core (setPitches for the
 * reflection cycle, setSyl for lyrics, setHarm for harmony); a plugin
 * that thinks it needs a NEW command is asking for a core change first.
 */
import type { PitchEvent } from "./document.js";

/** Write pitch content onto events (notes in child order for chords). Byte-identical revert. */
export interface SetPitchesMessage {
  type: "core.setPitches";
  targets: PitchEvent[];
  /** Undo-stack label, shown nowhere yet but recorded. */
  label: string;
}

export type CommandMessage = SetPitchesMessage;

export type CommandMessageType = CommandMessage["type"];

export const COMMAND_MESSAGE_TYPES: readonly CommandMessageType[] = ["core.setPitches"];
