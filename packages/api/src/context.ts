/**
 * What a plugin sees at runtime. Read side: stores (get + subscribe) over
 * the active document and the editor state. Write side: `execute` — the
 * ONLY mutation path, so undo integrity and byte-identical revert hold
 * for plugin commands exactly as for core ones — plus notices, confirm,
 * a settings namespace, a storage namespace, UI slots and panels.
 *
 * Plugins never touch the DOM, the SVG, the React tree or CoreScore
 * mutably. Anything document-shaped a plugin wants to keep goes in MEI
 * (through a command) or a declared sidecar; everything else in storage.
 */
import type { ReactNode } from "react";
import type { BlockSelection, CaretPosition, Command, CoreScore, EventIndex, MeasureContext } from "@battuta/core";
import type { Disposable, DisposableStore } from "./disposable.js";
import type { PluginManifest, SlotName } from "./manifest.js";

/** A value with change notification. `subscribe` fires on every change with the new value. */
export interface Store<T> {
  get(): T;
  subscribe(listener: (value: T) => void): Disposable;
}

/**
 * The active document, read-only. `version` bumps on every executed
 * command, undo and redo; a plugin that cached anything derived from the
 * score re-derives when it changes. The score is typed read-only; the
 * host does not (yet) freeze it — mutate it and you break undo.
 */
export interface ReadonlyDocument {
  readonly score: Readonly<CoreScore>;
  readonly index: EventIndex;
  readonly contexts: readonly MeasureContext[];
  readonly version: number;
}

export type ViewMode = "tiles" | "pages";

/** Caret and selections in model coordinates — never pixels. */
export interface EditorState {
  readonly caret: CaretPosition | null;
  /** Event selection: ordered event ids within one layer. */
  readonly selection: readonly string[];
  /** Block selection: a measure-range × staff-range rectangle. */
  readonly block: BlockSelection | null;
  readonly view: ViewMode;
  readonly entryMode: boolean;
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
  readonly document: Store<ReadonlyDocument | null>;
  readonly editor: Store<EditorState>;
  /** Runs a core Command against the active document as one undo step. Throws when no document is open. */
  execute(command: Command): void;
  /** Provides the handler for one of the plugin's declared commands; keybindings reach it through here. */
  registerCommand(id: string, handler: CommandHandler): Disposable;
  /** Bottom-right toast, same as the host's own notices. */
  notice(message: string): void;
  /** OK/Cancel that is visible in every build (native dialog in the shell). */
  confirm(message: string, title?: string): Promise<boolean>;
  readonly settings: SettingsNamespace;
  readonly storage: StorageNamespace;
  readonly slots: { add(slot: SlotName, item: SlotItem): Disposable };
  readonly panels: { open(panel: PanelSpec): Disposable };
  /** Disposed on deactivate. Add every subscription here; the host disposes what it handed out itself. */
  readonly subscriptions: DisposableStore;
}

/** What a plugin's entry module exports. */
export interface PluginModule {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/**
 * What the host registers: the manifest eagerly (declarative
 * contributions take effect at once), the code lazily (`load` is a
 * dynamic import, run on the first activation event).
 */
export interface PluginEntry {
  manifest: PluginManifest;
  load: () => Promise<PluginModule>;
}

/** Identity helper that types a plugin module; `export default definePlugin({ activate })`. */
export const definePlugin = (plugin: PluginModule): PluginModule => plugin;
