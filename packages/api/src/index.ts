/**
 * @battuta/api — the plugin contract of the battuta host.
 *
 * Imports nothing of the editor and, of core, only the plain-data document
 * types `document.ts` re-exports (core owns them). Everything a
 * plugin can see is data (document.ts), everything it can do is a
 * message (messages.ts) or a context call (context.ts).
 *
 * Semver'd separately from the app; a plugin declares the range it was
 * built against in its manifest's `engines.battuta`. A change to any
 * public type here requires a version bump: `api-report.d.ts` is the
 * committed snapshot of this surface and the surface test enforces it.
 */
export const API_VERSION = "0.1.14";

export type { ActivationEvent, HostCapability, SlotName, KeyboardLayout, CommandContribution, KeybindingContribution, SlotItemContribution, PluginContributions, PluginManifest } from "./manifest.js";
export { ACTIVATION_EVENT_PREFIXES, HOST_CAPABILITIES, SLOT_NAMES, validateManifest } from "./manifest.js";

export type { Disposable } from "./disposable.js";
export { toDisposable, DisposableStore } from "./disposable.js";

export type { Version } from "./semver.js";
export { parseVersion, satisfiesEngine } from "./semver.js";

export type { CaretPosition, BlockSelection, Pitch, PitchEvent, SylValue, HarmKind, NotationFacts, NoteMark, ViewMode, EditorState, DocumentInfo, DocumentQueries } from "./document.js";
export type { Timemap, TimemapEvent, TimemapNote } from "./render.js";
export type { AudioService } from "./audio.js";
export type { HighlightCue, ViewService } from "./view.js";
export type { ExportContribution, ExportFile, ExportPayload, ImportContribution, ImportFile, FormatsService } from "./formats.js";

export type { SetPitchesMessage, SetSylMessage, SetHarmMessage, CommandMessage, CommandMessageType } from "./messages.js";
export { COMMAND_MESSAGE_TYPES } from "./messages.js";

export type { MidiPort, MidiNoteEvent, MidiVirtualInput, MidiOutputs, MidiService } from "./midi.js";

export type { KeymapEntry, ActionsService } from "./actions.js";

export type { LanePlace, LaneContribution, LaneCommit, LaneCommitResult, LaneSpec, LanesService } from "./lanes.js";

export type { Store, SlotItem, PanelSide, PanelSpec, SettingsNamespace, StorageNamespace, CommandHandler, PluginContext, PluginModule, PluginEntry } from "./context.js";
export { definePlugin, resolvePluginModule } from "./context.js";
