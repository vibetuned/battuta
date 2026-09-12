/**
 * @battuta/api — the plugin contract of the battuta host.
 *
 * Semver'd separately from the app; a plugin declares the range it was
 * built against in its manifest's `engines.battuta`. A change to any
 * public type here requires a version bump: `api-report.d.ts` is the
 * committed snapshot of this surface and the surface test enforces it.
 */
export const API_VERSION = "0.1.0";

export type { ActivationEvent, HostCapability, SlotName, KeyboardLayout, CommandContribution, KeybindingContribution, PluginContributions, PluginManifest } from "./manifest.js";
export { ACTIVATION_EVENT_PREFIXES, HOST_CAPABILITIES, validateManifest } from "./manifest.js";

export type { Disposable } from "./disposable.js";
export { toDisposable, DisposableStore } from "./disposable.js";

export type { Version } from "./semver.js";
export { parseVersion, satisfiesEngine } from "./semver.js";

export type { Store, ReadonlyDocument, ViewMode, EditorState, SlotItem, PanelSide, PanelSpec, SettingsNamespace, StorageNamespace, CommandHandler, PluginContext, PluginModule, PluginEntry } from "./context.js";
export { definePlugin } from "./context.js";
