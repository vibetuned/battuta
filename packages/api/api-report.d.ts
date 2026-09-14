// @battuta/api 0.1.6 — public surface snapshot. Bump the version, then `npm run api:update -w @battuta/api`.

// ---- actions.d.ts
/**
 * Actions by id — the door an input surface uses instead of forging key
 * events. The host's key dispatcher is a table `actionId → handler`;
 * a physical key press selects an id through the keymap (rebindable
 * actions) or a fixed physical binding (the locked ones), and
 * `ctx.actions.run(id)` enters the SAME table at the same point, under the
 * same state conditions (no document, a lane open, a modal picker up →
 * nothing runs). A plugin therefore cannot do anything the host has not
 * named, and the edits it causes are ordinary core commands.
 *
 * Rebindable ids are the keymap's (`tie`, `dot`, `dynamics`, …, and every
 * plugin command). The locked physical and system keys have fixed ids:
 *
 *   undo, redo · zoom.in, zoom.out, zoom.reset · file.save, file.saveAs,
 *   file.open · clipboard.copy, clipboard.paste · measure.insert,
 *   measure.delete, measure.duplicate · entry.toggle · volta.1 … volta.9 ·
 *   finger.1 … finger.5, finger.add.1 … finger.add.5, fingerChange.1 …
 *   fingerChange.5 · duration.1 … duration.7 (the digit the user types:
 *   7 = whole … 1 = 64th) · pitch.a … pitch.g · chord.a … chord.g ·
 *   dynamic.f, dynamic.p · duration.shorter, duration.longer · nav.left,
 *   nav.right, nav.up, nav.down, nav.home, nav.end, nav.pageUp,
 *   nav.pageDown · select.left, select.right · transpose.up,
 *   transpose.down, transpose.octaveUp, transpose.octaveDown ·
 *   edit.delete, edit.backspace, edit.escape
 *
 * `ids` is the live list: every id `run` knows — the host's rules and
 * every enabled plugin's commands — as a Store, so a projection (the
 * on-screen keyboard) re-renders when a plugin is turned on or off or a
 * document opens, instead of trusting this comment or polling.
 */
import type { Store } from "./context.js";
/** One keymap entry as data: what the shortcut editor and the on-screen keyboard render. */
export interface KeymapEntry {
    /** Action id — a core id (`tie`) or a plugin's command id. */
    id: string;
    label: string;
    group: string;
    /** Context note, e.g. "block selection". */
    when?: string;
    /** e.key values that trigger it (letters carry their case); display text for locked rows. */
    keys: readonly string[];
    shift?: boolean;
    alt?: boolean;
    /** Listed for the user but not rebindable (a physical-code or ctrl-chord binding). */
    locked: boolean;
    /** Set on entries a plugin contributed (its id). */
    plugin?: string;
}
export interface ActionsService {
    /**
     * Run an action by id through the host's own dispatch table. True when
     * it ran; false when the id is unknown, or the state does not allow it
     * (no caret, a lane or picker owns the keyboard, the action's own
     * condition fails) — exactly when the key would have done nothing. A
     * plugin's command id runs through the registry, after the same gates,
     * as its key would.
     */
    run(id: string): boolean;
    /** Every id `run` knows — the host's, then every enabled plugin's commands — republished on every change. */
    readonly ids: Store<readonly string[]>;
}

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
import type { ActivationEvent, PluginManifest, SlotName } from "./manifest.js";
import type { CommandMessage } from "./messages.js";
import type { MidiService } from "./midi.js";
import type { ActionsService, KeymapEntry } from "./actions.js";
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
    readonly slots: {
        add(slot: SlotName, item: SlotItem): Disposable;
    };
    readonly panels: {
        open(panel: PanelSpec): Disposable;
    };
    /** Text lanes at the caret: register the spec of a lane you declared; open it from your own key. */
    readonly lanes: LanesService;
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
/** The two harmony lanes over one event: chord symbols (`<harm place="above">`) and Roman numerals (`<harm type="rna" place="below">`). */
export type HarmKind = "chord" | "rna";
/**
 * One verse-1 syllable, as MEI has it: `<syl wordpos con>` inside the
 * note's `<verse n="1">`. `wordpos` i/m/t = word start/middle/end, absent
 * for a whole word; `con: "d"` draws the hyphen to the next syllable.
 */
export interface SylValue {
    text: string;
    wordpos?: string;
    con?: string;
}
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
    /** The verse-1 syllable of a note or chord (a chord's sits on its first note), or null when it has none. */
    lyricAt(eventId: string): SylValue | null;
    /** The harmony text of one kind anchored at an event, "" when none. */
    harmAt(eventId: string, kind: HarmKind): string;
    /**
     * Would the document accept this text as a harmony of this kind? The
     * grammar that decides lives in core, because `core.setHarm` refuses
     * what fails it; a lane asks here rather than carrying a second copy.
     */
    harmValid(kind: HarmKind, text: string): boolean;
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
export declare const API_VERSION = "0.1.6";
export type { ActivationEvent, HostCapability, SlotName, KeyboardLayout, CommandContribution, KeybindingContribution, SlotItemContribution, PluginContributions, PluginManifest } from "./manifest.js";
export { ACTIVATION_EVENT_PREFIXES, HOST_CAPABILITIES, SLOT_NAMES, validateManifest } from "./manifest.js";
export type { Disposable } from "./disposable.js";
export { toDisposable, DisposableStore } from "./disposable.js";
export type { Version } from "./semver.js";
export { parseVersion, satisfiesEngine } from "./semver.js";
export type { CaretPosition, BlockSelection, Pitch, PitchEvent, SylValue, HarmKind, ViewMode, EditorState, DocumentInfo, DocumentQueries } from "./document.js";
export type { SetPitchesMessage, SetSylMessage, SetHarmMessage, CommandMessage, CommandMessageType } from "./messages.js";
export { COMMAND_MESSAGE_TYPES } from "./messages.js";
export type { MidiPort, MidiNoteEvent, MidiVirtualInput, MidiOutputs, MidiService } from "./midi.js";
export type { KeymapEntry, ActionsService } from "./actions.js";
export type { LanePlace, LaneContribution, LaneCommit, LaneCommitResult, LaneSpec, LanesService } from "./lanes.js";
export type { Store, SlotItem, PanelSide, PanelSpec, SettingsNamespace, StorageNamespace, CommandHandler, PluginContext, PluginModule, PluginEntry } from "./context.js";
export { definePlugin, resolvePluginModule } from "./context.js";

// ---- lanes.d.ts
/**
 * Lanes — a typed text lane at the caret. The host owns the MECHANISM
 * (one buffer, one modal key protocol, the floating editor, the status-bar
 * entry, the advance over the caret path); a lane contributes only what
 * differs between lanes: what it attaches to, how the caret advances, which
 * keys commit, which characters it admits, what "complete" and
 * "suggestions" mean, how to read the current value and how to turn the
 * buffer into ONE command message.
 *
 * Read off the two lanes the editor had before the point existed
 * (harmony's chord symbols and Roman numerals, and lyrics), so each field
 * exists because one of them needed it: `accepts` / `transform` /
 * `complete` / `suggest` are harmony's closed grammar, `advance: "note"`
 * and `-` among the advance keys are lyrics'. The host knows nothing about
 * the TEXT of any lane — no grammar, no MEI shape.
 *
 * The protocol, for every open lane:
 *   Escape        commit, then leave the lane
 *   an advance key   commit, then move the caret on (`advance` says how far)
 *   ← →           commit, then step one event
 *   Backspace     delete the last character
 *   Tab           take the first suggestion (only when the lane suggests)
 *   a character   admitted when `accepts` says so (or always, when absent),
 *                 mapped by `transform` first; never with ctrl/meta/alt
 * A commit that returns null changes nothing and the key proceeds; one that
 * returns `{ refuse }` shows the reason and the key stops there.
 */
import type { Disposable } from "./disposable.js";
import type { CommandMessage } from "./messages.js";
export type LanePlace = "above" | "below";
/**
 * A lane DECLARED in the manifest (`contributes.lanes`): the host lists it
 * in the status bar before the plugin's code loads, and picking it fires
 * `onLane:<id>` — the plugin then registers the spec and the lane opens.
 * Lane ids are global, like command ids: `<pluginId>.<name>`.
 */
export interface LaneContribution {
    id: string;
    /** The status-bar option, e.g. "lyrics (verse 1, l)". */
    label: string;
    /** The short name shown while the lane is open and in its notices, e.g. "lyrics". */
    name: string;
    /** Prefix of the floating editor, e.g. "♪". */
    glyph?: string;
    /** Above or below the staff: where the floating editor sits. */
    place: LanePlace;
}
/** What the host hands `commit`: everything a lane may need to build its message. */
export interface LaneCommit {
    /** The event under the caret. */
    eventId: string;
    buffer: string;
    /** The key that committed: "Escape", an advance key, "ArrowLeft" / "ArrowRight". */
    key: string;
    /**
     * The previous event of the lane's kind along the caret path (a NOTE
     * for `advance: "note"`, any event otherwise), or null at the start.
     * Lyrics read the previous syllable's continuation off it.
     */
    prevEventId: string | null;
}
/** Nothing to write (null), a message to execute, or a refusal the host shows as a notice. */
export type LaneCommitResult = CommandMessage | null | {
    refuse: string;
};
export interface LaneSpec extends LaneContribution {
    /**
     * What the lane's value hangs on. A commit on anything else is refused
     * with a notice — except an EMPTY buffer, which the caret may carry past
     * a rest without complaint.
     */
    attachesTo: "note" | "event";
    /** Where an advance key moves the caret: the next event, or the next NOTE with rests skipped. */
    advance: "event" | "note";
    /** Keys that commit and advance, e.g. ["Enter"] or [" ", "Enter", "-"]. */
    advanceOn: readonly string[];
    /** The notice shown when the lane opens (how to use it). */
    hint?: string;
    /** Which single characters may extend the buffer. Absent: any printable character. */
    accepts?(ch: string): boolean;
    /** Map a typed character before it is admitted (e.g. "o" → "°"). */
    transform?(ch: string): string;
    /** Is the buffer a complete value? Drives the editor's valid/invalid colour; absent: always complete. */
    complete?(buffer: string): boolean;
    /** Completions for the buffer, shown beside it; Tab takes the first. */
    suggest?(buffer: string): readonly string[];
    /** The current value at an event, as the buffer should show it ("" when none). */
    read(eventId: string): string;
    commit(c: LaneCommit): LaneCommitResult;
}
export interface LanesService {
    /**
     * Register the spec for a lane this plugin DECLARED in its manifest.
     * Disposed with the plugin (or by hand): the declared face returns to the
     * status bar and the lane, if open, closes.
     */
    register(spec: LaneSpec): Disposable;
    /**
     * Open a lane by id at the caret — for a plugin's own key. False when the
     * lane is unknown or there is no caret. Opening leaves entry mode, as the
     * status-bar select does; a key that must NOT do that in entry mode
     * declines on `ctx.editor.get().entryMode` first.
     */
    open(id: string): boolean;
}

// ---- manifest.d.ts
/**
 * The plugin manifest: everything the host needs to know about a plugin
 * WITHOUT loading its code. Declarative contributions (commands,
 * keybindings) take effect at registration; the code is fetched only
 * when one of the activation events fires. A disabled or never-triggered
 * plugin therefore costs exactly one manifest object.
 */
import type { LaneContribution } from "./lanes.js";
/** Events the host fires; a plugin's code loads on the first one it declares. */
export type ActivationEvent = "onStartup" | `onCommand:${string}` | `onLane:${string}` | `onFormat:${string}` | `onDocument:${string}` | `onView:${string}` | "onPlay" | `onPointer:${string}`
/**
 * Fired at startup for a plugin whose OWN settings namespace holds a
 * truthy value under `<key>` — "you were in use when I last quit, come
 * back". How a persisted UI state (an open panel) survives a restart
 * without `onStartup` costing every user the code at launch.
 */
 | `onSettings:${string}`;
export declare const ACTIVATION_EVENT_PREFIXES: readonly ["onStartup", "onCommand:", "onLane:", "onFormat:", "onDocument:", "onView:", "onPlay", "onPointer:", "onSettings:"];
/**
 * Host capabilities a manifest may require. A capability is a platform
 * service with a browser backend and a shell backend (never a plugin);
 * the host refuses to register a plugin needing one it does not offer.
 * Grows as host services are lifted (`midi` lands in slice 3).
 */
export type HostCapability = "midi" | "workspace" | "playback";
export declare const HOST_CAPABILITIES: readonly HostCapability[];
/**
 * UI slots a plugin may place an item in. `header` is the first header row
 * (tabs, view toggle); `docHeader` the second (title, tempo, and the player
 * in page view — where a playback plugin's controls go); `statusBar` the
 * bottom bar; `menu` the battuta menu. Panels are a separate mechanism.
 */
export type SlotName = "header" | "docHeader" | "statusBar" | "menu";
export declare const SLOT_NAMES: readonly SlotName[];
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
/**
 * A slot item DECLARED in the manifest rather than added at runtime: the
 * host renders it before the plugin's code has ever loaded, and clicking
 * it runs one of the plugin's commands — which is what activates the
 * plugin. This is how a plugin's UI gets an entry point: a button that
 * opens a panel cannot be contributed by the panel's own code, or it would
 * not be there to open it. Runtime `ctx.slots.add` stays the way to
 * contribute an item that needs live state.
 */
export interface SlotItemContribution {
    /** Stable within the plugin. */
    id: string;
    slot: SlotName;
    /** The item's face: an emoji or a very short label. */
    label: string;
    /** Tooltip. */
    title?: string;
    /** Run on click; must be one of the plugin's own `commands`. */
    command: string;
    /** Lower renders first among the slot's items. */
    order?: number;
    /**
     * Draw this face de-emphasised until the plugin is active. For an entry
     * point that OPENS something (the 🎹 and its panel), "not active" means
     * "not showing", so a lit button would be a small lie — and the plugin's
     * own runtime item takes the face over the moment it runs. Leave it
     * unset for an item that simply runs a command, which is not disabled in
     * any sense while its plugin waits to be loaded.
     */
    dimUntilActive?: boolean;
}
export interface PluginContributions {
    commands?: CommandContribution[];
    keybindings?: KeybindingContribution[];
    slotItems?: SlotItemContribution[];
    /** Text lanes at the caret, listed in the status bar before the plugin loads; see lanes.ts. */
    lanes?: LaneContribution[];
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
import type { HarmKind, PitchEvent, SylValue } from "./document.js";
/** Write pitch content onto events (notes in child order for chords). Byte-identical revert. */
export interface SetPitchesMessage {
    type: "core.setPitches";
    targets: PitchEvent[];
    /** Undo-stack label, shown nowhere yet but recorded. */
    label: string;
}
/**
 * Set (or, with empty text, clear) the verse-1 syllable of a note or
 * chord. Refused on a rest. One undo step; byte-identical revert. The
 * command labels itself (`lyric "hel"`, `lyric removed`).
 */
export interface SetSylMessage {
    type: "core.setSyl";
    eventId: string;
    value: SylValue;
}
/**
 * Set (or, with empty text, clear) the harmony of one kind at an event —
 * a chord symbol above or a Roman numeral below. Refused when the text is
 * not one the grammar accepts (`ctx.query.harmValid` asks the same
 * grammar first). One undo step; byte-identical revert; labels itself.
 */
export interface SetHarmMessage {
    type: "core.setHarm";
    eventId: string;
    kind: HarmKind;
    text: string;
}
export type CommandMessage = SetPitchesMessage | SetSylMessage | SetHarmMessage;
export type CommandMessageType = CommandMessage["type"];
export declare const COMMAND_MESSAGE_TYPES: readonly CommandMessageType[];

// ---- midi.d.ts
/**
 * The MIDI host service — the first "platform capability with a browser
 * backend and a shell backend, consumed by features" to live in the host
 * rather than in a plugin. Web MIDI in browsers, the midir bridge in the
 * Tauri shell; plugins see one interface and never ask which.
 *
 * Inputs are deduped by port name (some drivers register a device twice)
 * and hot-plugged. A plugin may register a VIRTUAL input — the on-screen
 * piano is one — so every input surface feeds the same note stream the
 * entry path listens to, and nobody asks whether "the MIDI plugin" is
 * installed. Outputs open all at once; the handle schedules sends on the
 * performance.now() clock and its panic() releases everything sounding.
 */
import type { Disposable } from "./disposable.js";
import type { Store } from "./context.js";
/** An input port. Virtual ones were registered by the host or a plugin, not enumerated from hardware. */
export interface MidiPort {
    name: string;
    virtual: boolean;
}
/** One note on/off from any input; `source` is the port name. */
export interface MidiNoteEvent {
    note: number;
    on: boolean;
    /** 0 for an off. */
    velocity: number;
    source: string;
}
/** A software input the service treats like a device. Dispose to unregister. */
export interface MidiVirtualInput extends Disposable {
    readonly name: string;
    noteOn(note: number, velocity?: number): void;
    noteOff(note: number): void;
}
/** Every output port, opened together. Sends go to all of them. */
export interface MidiOutputs {
    /** Deduped port names (for notices). */
    readonly names: readonly string[];
    /** Send at `atMs` on the performance.now() clock; past times send now. */
    schedule(data: number[], atMs: number): void;
    /** Send now. */
    send(data: number[]): void;
    /** Cancel every pending send and release every sounding note (note-offs + CC 123). */
    panic(): void;
    /** panic() and release the ports (the shell retracts its virtual source). */
    close(): void;
}
export interface MidiService {
    /** Hardware inputs (deduped, hot-plugged) followed by registered virtual inputs. */
    readonly inputs: Store<readonly MidiPort[]>;
    /** Every note on/off from every input, hardware or virtual. */
    onNote(listener: (event: MidiNoteEvent) => void): Disposable;
    /** Add an input the service will report and route like a device. */
    registerInput(name: string): MidiVirtualInput;
    /** Open every available output; null when there is none (callers fall back to audio). */
    openOutputs(): Promise<MidiOutputs | null>;
}

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
