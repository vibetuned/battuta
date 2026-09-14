/**
 * @battuta/api — the plugin contract of the battuta host.
 *
 * Standalone: no dependency on @battuta/core or the editor. Everything a
 * plugin can see is data (document.ts), everything it can do is a
 * message (messages.ts) or a context call (context.ts).
 *
 * Semver'd separately from the app; a plugin declares the range it was
 * built against in its manifest's `engines.battuta`. A change to any
 * public type here requires a version bump: `api-report.d.ts` is the
 * committed snapshot of this surface and the surface test enforces it.
 */
export const API_VERSION = "0.1.4";

export type { ActivationEvent, HostCapability, SlotName, KeyboardLayout, CommandContribution, KeybindingContribution, SlotItemContribution, PluginContributions, PluginManifest } from "./manifest.js";
export { ACTIVATION_EVENT_PREFIXES, HOST_CAPABILITIES, SLOT_NAMES, validateManifest } from "./manifest.js";

export type { Disposable } from "./disposable.js";
export { toDisposable, DisposableStore } from "./disposable.js";

export type { Version } from "./semver.js";
export { parseVersion, satisfiesEngine } from "./semver.js";

export type { CaretPosition, BlockSelection, Pitch, PitchEvent, ViewMode, EditorState, DocumentInfo, DocumentQueries } from "./document.js";

export type { SetPitchesMessage, CommandMessage, CommandMessageType } from "./messages.js";
export { COMMAND_MESSAGE_TYPES } from "./messages.js";

export type { MidiPort, MidiNoteEvent, MidiVirtualInput, MidiOutputs, MidiService } from "./midi.js";

export type { KeymapEntry, ActionsService } from "./actions.js";

export type { Store, SlotItem, PanelSide, PanelSpec, SettingsNamespace, StorageNamespace, CommandHandler, PluginContext, PluginModule, PluginEntry } from "./context.js";
export { definePlugin, resolvePluginModule } from "./context.js";
