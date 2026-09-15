/**
 * What a plugin sees at runtime. Read side: stores (get + subscribe) over
 * the document snapshot and the editor state, plus the query facade.
 * Write side: `execute(message)` — the ONLY mutation path, so undo
 * integrity and byte-identical revert hold for plugin edits exactly as
 * for core ones — plus notices, confirm, a settings namespace, a storage
 * namespace, UI slots and panels.
 *
 * Plugins never touch the DOM, the SVG, the React tree or the document
 * model. Anything document-shaped a plugin wants to keep goes into MEI
 * through a message; everything else into storage.
 */
import type { ReactNode } from "react";
import type { Disposable, DisposableStore } from "./disposable.js";
import type { DocumentInfo, DocumentQueries, EditorState } from "./document.js";
import type { ActivationEvent, PluginManifest, SlotName } from "./manifest.js";
import type { CommandMessage } from "./messages.js";
import type { MidiService } from "./midi.js";
import type { ActionsService, KeymapEntry } from "./actions.js";
import type { AudioService } from "./audio.js";
import type { ViewService } from "./view.js";
import type { FormatsService } from "./formats.js";
import type { WorkspaceService } from "./workspace.js";
import type { LanesService } from "./lanes.js";

/** A value with change notification. `subscribe` fires on every change with the new value. */
export interface Store<T> {
  get(): T;
  subscribe(listener: (value: T) => void): Disposable;
}

/** An item rendered inside a host slot (header row, status bar, battuta menu). */
export interface SlotItem {
  id: string;
  /** Lower renders first; items without an order keep registration order after ordered ones. */
  order?: number;
  render: () => ReactNode;
}

export type PanelSide = "bottom" | "side";

/** A panel the host mounts in its bottom or side area while the disposable lives. */
export interface PanelSpec {
  id: string;
  side: PanelSide;
  title: string;
  render: () => ReactNode;
}

/** Per-plugin key/value settings, persisted with the editor settings (survive restarts, small values). */
export interface SettingsNamespace {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

/** Per-plugin storage for anything larger than a setting; persisted in web storage. */
export interface StorageNamespace extends SettingsNamespace {
  remove(key: string): void;
  clear(): void;
}

export type CommandHandler = (args?: unknown) => void | Promise<void>;

export interface PluginContext {
  readonly manifest: PluginManifest;
  /** The host's `@battuta/api` version. */
  readonly apiVersion: string;
  /**
   * The activation event that woke this plugin — `onStartup`,
   * `onPointer:coarse`, `onCommand:<id>` (a key or a declared slot item),
   * `onSettings:<key>` — or null when it was started directly (the
   * Plugins tab, a test). Activation runs BEFORE the command handler that
   * caused it, so a plugin with a toggle needs this to know whether to
   * open its UI now or leave that to the handler about to run.
   */
  readonly activatedBy: ActivationEvent | null;
  /** The active document as a snapshot, null when none is open. Republished after every edit — see DocumentInfo. */
  readonly document: Store<DocumentInfo | null>;
  /** Every open document, in tab order (the active one is `document`). For "which files are open, which are unsaved". */
  readonly documents: Store<readonly DocumentInfo[]>;
  readonly editor: Store<EditorState>;
  /** Questions about the active document, answered as data. */
  readonly query: DocumentQueries;
  /** Runs a command message against the active document as one undo step. Throws when no document is open. */
  execute(message: CommandMessage): void;
  /** Provides the handler for one of the plugin's declared commands; keybindings reach it through here. */
  registerCommand(id: string, handler: CommandHandler): Disposable;
  /** Bottom-right toast, same as the host's own notices. */
  notice(message: string): void;
  /** OK/Cancel that is visible in every build (native dialog in the shell). */
  confirm(message: string, title?: string): Promise<boolean>;
  readonly settings: SettingsNamespace;
  readonly storage: StorageNamespace;
  /** The MIDI host service (capability "midi"): inputs, a note stream, virtual inputs, outputs. */
  readonly midi: MidiService;
  /** The union keymap as data (core ∪ every enabled plugin's contributions), republished on every change. */
  readonly keymap: Store<readonly KeymapEntry[]>;
  /** Run the host's actions by id — the door for input surfaces. See actions.ts. */
  readonly actions: ActionsService;
  /**
   * Slot items. An item whose `id` equals one of the plugin's DECLARED slot
   * items replaces that item's face while it lives — so a declared entry
   * point (static, rendered before the code loads) becomes a live,
   * stateful button once the plugin is active, and returns to its declared
   * face on deactivate.
   */
  readonly slots: { add(slot: SlotName, item: SlotItem): Disposable };
  readonly panels: { open(panel: PanelSpec): Disposable };
  /** Text lanes at the caret: register the spec of a lane you declared; open it from your own key. */
  readonly lanes: LanesService;
  /** The app's one AudioContext (capability "audio"): unlock it in your click, connect your own instrument, convert clocks with timeAt. */
  readonly audio: AudioService;
  /** The notation on screen: light engraved ids in page view as they sound. */
  readonly view: ViewService;
  /** Exports and imports: provide the producer or converter for one you declared. */
  readonly formats: FormatsService;
  /** The folders the user opened, read-only and scoped (capability "workspace"); unavailable in a browser. */
  readonly workspace: WorkspaceService;
  /** Disposed on deactivate. Add every subscription here; the host disposes what it handed out itself. */
  readonly subscriptions: DisposableStore;
}

/** What a plugin's entry module exports (as its default export). */
export interface PluginModule {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/**
 * What the host registers: the manifest eagerly (declarative
 * contributions take effect at once), the code lazily. `load` is a
 * dynamic import — `() => import("@battuta/plugin-x")` — which resolves
 * to the module NAMESPACE; the host unwraps its default export.
 */
export interface PluginEntry {
  manifest: PluginManifest;
  load: () => Promise<PluginModule | { default: PluginModule }>;
}

/** Identity helper that types a plugin module; `export default definePlugin({ activate })`. */
export const definePlugin = (plugin: PluginModule): PluginModule => plugin;

/** Unwraps what `PluginEntry.load` resolved to — a module namespace or the module itself. */
export function resolvePluginModule(loaded: PluginModule | { default: PluginModule }): PluginModule {
  const candidate = "default" in loaded && loaded.default && typeof (loaded.default as PluginModule).activate === "function" ? loaded.default : (loaded as PluginModule);
  if (typeof candidate.activate !== "function") throw new Error("plugin module has no activate(): export default definePlugin({ activate })");
  return candidate;
}
