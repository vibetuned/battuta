// @battuta/api 0.1.0 — public surface snapshot. Bump the version, then `npm run api:update -w @battuta/api`.

// ---- context.d.ts
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
    readonly slots: {
        add(slot: SlotName, item: SlotItem): Disposable;
    };
    readonly panels: {
        open(panel: PanelSpec): Disposable;
    };
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
export declare const definePlugin: (plugin: PluginModule) => PluginModule;

// ---- disposable.d.ts
/**
 * Lifecycle plumbing. Everything a plugin registers returns a Disposable;
 * the host collects them per plugin and disposes the lot on deactivate,
 * so "off" is complete by construction rather than by discipline.
 */
export interface Disposable {
    dispose(): void;
}
export declare const toDisposable: (fn: () => void) => Disposable;
export declare class DisposableStore implements Disposable {
    private readonly items;
    private disposed;
    get isDisposed(): boolean;
    /** Adds and returns the same disposable (so `const d = store.add(x)` reads well). */
    add<T extends Disposable>(d: T): T;
    dispose(): void;
}

// ---- index.d.ts
/**
 * @battuta/api — the plugin contract of the battuta host.
 *
 * Semver'd separately from the app; a plugin declares the range it was
 * built against in its manifest's `engines.battuta`. A change to any
 * public type here requires a version bump: `api-report.d.ts` is the
 * committed snapshot of this surface and the surface test enforces it.
 */
export declare const API_VERSION = "0.1.0";
export type { ActivationEvent, HostCapability, SlotName, KeyboardLayout, CommandContribution, KeybindingContribution, PluginContributions, PluginManifest } from "./manifest.js";
export { ACTIVATION_EVENT_PREFIXES, HOST_CAPABILITIES, validateManifest } from "./manifest.js";
export type { Disposable } from "./disposable.js";
export { toDisposable, DisposableStore } from "./disposable.js";
export type { Version } from "./semver.js";
export { parseVersion, satisfiesEngine } from "./semver.js";
export type { Store, ReadonlyDocument, ViewMode, EditorState, SlotItem, PanelSide, PanelSpec, SettingsNamespace, StorageNamespace, CommandHandler, PluginContext, PluginModule, PluginEntry } from "./context.js";
export { definePlugin } from "./context.js";

// ---- manifest.d.ts
/**
 * The plugin manifest: everything the host needs to know about a plugin
 * WITHOUT loading its code. Declarative contributions (commands,
 * keybindings) take effect at registration; the code is fetched only
 * when one of the activation events fires. A disabled or never-triggered
 * plugin therefore costs exactly one manifest object.
 */
/** Events the host fires; a plugin's code loads on the first one it declares. */
export type ActivationEvent = "onStartup" | `onCommand:${string}` | `onLane:${string}` | `onFormat:${string}` | `onDocument:${string}` | `onView:${string}` | "onPlay" | `onPointer:${string}`;
export declare const ACTIVATION_EVENT_PREFIXES: readonly ["onStartup", "onCommand:", "onLane:", "onFormat:", "onDocument:", "onView:", "onPlay", "onPointer:"];
/**
 * Host capabilities a manifest may require. A capability is a platform
 * service with a browser backend and a shell backend (never a plugin);
 * the host refuses to register a plugin needing one it does not offer.
 * Grows as host services are lifted (`midi` lands in slice 3).
 */
export type HostCapability = "midi" | "workspace" | "playback";
export declare const HOST_CAPABILITIES: readonly HostCapability[];
/** UI slots a plugin may place an item in. Panels are a separate mechanism. */
export type SlotName = "header" | "statusBar" | "menu";
export type KeyboardLayout = "qwerty" | "azerty";
export interface CommandContribution {
    /** Global command id; convention `<pluginId>.<verb>`, e.g. `battuta.reflection.cycle`. */
    id: string;
    /** Shown in menus and notices. */
    title: string;
}
export interface KeybindingContribution {
    /** The command this key runs; must be one of the plugin's own `commands`. */
    command: string;
    /** e.key values that trigger it (letters carry their case, so "R" means shift+r). */
    keys: string[];
    /** When set, e.altKey must equal it; unset means alt must be OFF. */
    alt?: boolean;
    /** When set, e.shiftKey must equal it (for non-letter keys). */
    shift?: boolean;
    /** Row label in the shortcut editor and the on-screen keyboard. */
    label: string;
    /** Shortcut-editor group: an existing one (entry, accidentals, marks, rhythm, repeats, system) or a new one. */
    group: string;
    /** Context note shown in the editor, e.g. "block selection". */
    when?: string;
    /** Per-layout key overrides where the default keys do not exist on a layout. */
    layouts?: Partial<Record<KeyboardLayout, {
        keys: string[];
        shift?: boolean;
    }>>;
}
export interface PluginContributions {
    commands?: CommandContribution[];
    keybindings?: KeybindingContribution[];
}
export interface PluginManifest {
    /** Dotted lowercase id, e.g. `battuta.reflection`. Unique across the registry. */
    id: string;
    /** Display name for the Plugins tab. */
    name: string;
    /** The plugin's own version (informational). */
    version: string;
    description?: string;
    /** The `@battuta/api` range this plugin was built against, e.g. `^0.1.0`. */
    engines: {
        battuta: string;
    };
    activationEvents: ActivationEvent[];
    capabilities?: HostCapability[];
    contributes?: PluginContributions;
}
/** Every problem with a manifest, in plain words; empty means valid. */
export declare function validateManifest(input: unknown): string[];

// ---- semver.d.ts
/**
 * The engine check: does the host's API version satisfy a plugin's
 * `engines.battuta` range? A deliberately small semver — exact, `^`, `~`,
 * comparison operators, `*`, and space-separated conjunctions — so the
 * API package carries no runtime dependency.
 */
export interface Version {
    major: number;
    minor: number;
    patch: number;
}
export declare function parseVersion(v: string): Version | null;
/** True when `version` lies inside `range` (all space-separated comparators must hold). */
export declare function satisfiesEngine(range: string, version: string): boolean;
