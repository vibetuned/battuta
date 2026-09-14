// @battuta/api 0.1.0 — public surface snapshot. Bump the version, then `npm run api:update -w @battuta/api`.

// ---- context.d.ts
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
import type { PluginManifest, SlotName } from "./manifest.js";
import type { CommandMessage } from "./messages.js";
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
    /** The active document as a snapshot, null when none is open. Republished after every edit — see DocumentInfo. */
    readonly document: Store<DocumentInfo | null>;
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
    readonly slots: {
        add(slot: SlotName, item: SlotItem): Disposable;
    };
    readonly panels: {
        open(panel: PanelSpec): Disposable;
    };
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
    load: () => Promise<PluginModule | {
        default: PluginModule;
    }>;
}
/** Identity helper that types a plugin module; `export default definePlugin({ activate })`. */
export declare const definePlugin: (plugin: PluginModule) => PluginModule;
/** Unwraps what `PluginEntry.load` resolved to — a module namespace or the module itself. */
export declare function resolvePluginModule(loaded: PluginModule | {
    default: PluginModule;
}): PluginModule;

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

// ---- document.d.ts
/**
 * What a plugin may know about the document — as DATA. Every type here
 * is plain JSON: no classes, no live objects, no core imports. That is
 * what keeps the API message-passing-friendly (a worker host or
 * third-party loading stays a deferral, not a rewrite) and what makes
 * "everything through @battuta/api" true rather than aspirational: there
 * is nothing of the document model here to reach into.
 */
/** Caret position in model coordinates — never pixels. */
export interface CaretPosition {
    measureIndex: number;
    staffN: number;
    layerN: number;
    eventIndex: number;
}
/** Block selection: inclusive measure-index range × inclusive staff-number range. */
export interface BlockSelection {
    measureFrom: number;
    measureTo: number;
    staffFrom: number;
    staffTo: number;
}
/** One written pitch (MEI @pname/@oct, with the accidental attributes when present). */
export interface Pitch {
    pname: string;
    oct: number;
    accid?: string;
    accidGes?: string;
}
/** A pitched event (note or chord): its id and its pitches in child order. */
export interface PitchEvent {
    eventId: string;
    pitches: Pitch[];
}
export type ViewMode = "tiles" | "pages";
/** Caret and selections, in model coordinates. */
export interface EditorState {
    readonly caret: CaretPosition | null;
    /** Event selection: ordered event ids within one layer. */
    readonly selection: readonly string[];
    /** Block selection: the dragged rectangle, or null. */
    readonly block: BlockSelection | null;
    readonly view: ViewMode;
    readonly entryMode: boolean;
}
/**
 * The active document, as a snapshot. `version` bumps on every executed
 * command, undo and redo. The host publishes a new snapshot AFTER its own
 * render cycle, so a plugin cannot observe the result of its own
 * `execute` synchronously — learn it from `ctx.document.subscribe`.
 */
export interface DocumentInfo {
    /** Stable for the life of an open tab; reopening a file yields a new id. */
    id: string;
    version: number;
    measureCount: number;
    staffCount: number;
    title: string;
    /** `@midi.bpm` on the scoreDef; null when the score sets none. */
    tempo: number | null;
}
/**
 * Questions a plugin may ask the active document. Answered by the host
 * from the live model; every answer is data. With no document open the
 * answers are empty (`[]`, `null`). Grows one question at a time, when a
 * plugin being built needs it — never speculatively.
 */
export interface DocumentQueries {
    /** Pitched events of a block, one sequence per (staff, layer) voice, in measure order. Rests are skipped. */
    pitchEventsIn(block: BlockSelection): PitchEvent[][];
    /** The measure × staff rectangle an event selection covers (the editor's own rule), or null when empty. */
    blockOf(eventIds: readonly string[]): BlockSelection | null;
}

// ---- index.d.ts
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
export declare const API_VERSION = "0.1.0";
export type { ActivationEvent, HostCapability, SlotName, KeyboardLayout, CommandContribution, KeybindingContribution, PluginContributions, PluginManifest } from "./manifest.js";
export { ACTIVATION_EVENT_PREFIXES, HOST_CAPABILITIES, validateManifest } from "./manifest.js";
export type { Disposable } from "./disposable.js";
export { toDisposable, DisposableStore } from "./disposable.js";
export type { Version } from "./semver.js";
export { parseVersion, satisfiesEngine } from "./semver.js";
export type { CaretPosition, BlockSelection, Pitch, PitchEvent, ViewMode, EditorState, DocumentInfo, DocumentQueries } from "./document.js";
export type { SetPitchesMessage, CommandMessage, CommandMessageType } from "./messages.js";
export { COMMAND_MESSAGE_TYPES } from "./messages.js";
export type { Store, SlotItem, PanelSide, PanelSpec, SettingsNamespace, StorageNamespace, CommandHandler, PluginContext, PluginModule, PluginEntry } from "./context.js";
export { definePlugin, resolvePluginModule } from "./context.js";

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

// ---- messages.d.ts
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
export declare const COMMAND_MESSAGE_TYPES: readonly CommandMessageType[];

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
