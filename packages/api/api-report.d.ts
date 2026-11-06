// @battuta/api 1.3.12 — public surface snapshot. Bump the version, then `npm run api:update -w @battuta/api`.

// ---- ../dist/.tsbuildinfo
{"version":"5.9.3"}

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

// ---- audio.d.ts
/**
 * The audio host service (capability "audio"): the app's ONE Web Audio
 * context. The host owns the context, not an instrument — a plugin brings
 * its own synth or sampler and connects it here, so a player, a
 * metronome and a note preview share one context and never fight over
 * the autoplay unlock.
 *
 * `unlock()` must be called inside a user gesture, before any `await` —
 * browsers bind the AudioContext unlock to the click that caused it. The
 * host creates the context on the first call and resumes it on every one.
 */
export interface AudioService {
    /** Create (once) and resume the shared context. Call it in the click handler, first thing. Resolves once running; resolves too where the platform has no Web Audio. */
    unlock(): Promise<void>;
    /** The shared context — null before the first unlock, and where the platform has none (tests, a headless shell). */
    context(): AudioContext | null;
    /**
     * The `performance.now()` clock in the context's seconds: schedule an
     * attack for a wall-clock instant sample-accurately, the way a MIDI sink
     * schedules a send (`MidiOutputs.schedule` takes the same `atMs`).
     */
    timeAt(atMs: number): number;
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
import type { AudioService } from "./audio.js";
import type { ViewService } from "./view.js";
import type { OverlaysService } from "./overlays.js";
import type { FormatsService } from "./formats.js";
import type { WorkspaceService } from "./workspace.js";
import type { StylusService } from "./stylus.js";
import type { KeysService } from "./keys.js";
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
/**
 * Where a panel goes: the bottom area, the side area, or (1.3.4) `float` —
 * over the window's bottom-left corner, above the score, with no frame and
 * no title, taking no click or touch: for what is only to be seen.
 */
export type PanelSide = "bottom" | "side" | "float";
/** A panel the host mounts in its bottom, side or float area while the disposable lives. */
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
    /**
     * Set the input's note length (`editor`'s `entryDur` / `entryDots`), as
     * typing a digit does in input mode, without entering anything or
     * turning input mode on. Throws on a duration other than "1" … "64" or
     * dots other than 0–2. Added 1.3.0: a length the stylus cross chose
     * becomes the input's.
     */
    setEntryLength(dur: string, dots?: number): void;
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
    /** The overlays point: draw over every measure tile in edit view, from the tile's measured boxes and staff lines — never on the SVG. */
    readonly overlays: OverlaysService;
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
    /** The Apple Pencil and the S Pen on the score (capability "stylus"); available in the iOS and Android shells only. */
    readonly stylus: StylusService;
    /** Every key press the editor handles, as data, with the action it ran (1.3.4). */
    readonly keys: KeysService;
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
/**
 * Core owns the document's data types; the api RE-EXPORTS exactly these —
 * plain JSON, no model, no class — and nothing else of `@battuta/core`.
 * Adding a name here is a contract change (the surface report inlines
 * the re-exported shapes, so a change to one of them in core shows up as
 * a surface change and needs a version bump); a plugin still imports only
 * `@battuta/api`, and the boundary test keeps it that way.
 */
import type { CaretPosition, BlockSelection, PitchEvent, SylValue, HarmKind, NotationFacts } from "@battuta/core";
export type { CaretPosition, BlockSelection, Pitch, PitchEvent, SylValue, HarmKind, NotationFacts, NoteMark, ClefContext, MeterContext, StaffContext } from "@battuta/core";
import type { Timemap } from "./render.js";
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
    /**
     * The input's note length — what digits 1–7 pick and the dot adds: the
     * written duration ("1" whole, "2" half, "4" quarter … "64") and its
     * dots. Kept while input mode is off. Added 1.3.0 for the stylus, whose
     * taps write it; `ctx.setEntryLength` sets it.
     */
    readonly entryDur: string;
    readonly entryDots: number;
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
    /**
     * The document's NAME as the tab shows it — the file's base name without
     * its extension, or what the user was given for an untitled score. Not
     * the MEI title (that is `title`, often empty). For naming what you
     * derive from the document: an export, a sidecar. Added 2026-09-15 for
     * the playback-MIDI export (`<name>-playback.mid`) and slice 9's folder
     * view.
     */
    name: string;
    /** The disk path when the document came from disk or was saved to it (shell); absent for imported and new scores. */
    path?: string;
    /** Unsaved changes — the tab's marker. */
    dirty: boolean;
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
     * Would the document accept this text as a harmony of this kind? Core
     * owns the grammar that decides, because more than one plugin may write
     * a harmony (the lane today, a generator tomorrow) and every writer must
     * be refused the same text; `core.setHarm` refuses what fails it. Ask
     * here — a lane's `complete`, a generator's filter — never copy it.
     * Needs no document: a grammar question.
     */
    harmValid(kind: HarmKind, text: string): boolean;
    /**
     * Verovio's timemap for the document, of the expanded form — a render
     * service, read-only (see render.ts). Null with no document open;
     * rejects with the render error. A player builds its own performance
     * from this and `notation()`.
     */
    timemap(): Promise<Timemap | null>;
    /** The notation facts a performance interprets: which note ties into which, which marks a note carries. Empty without a document. */
    notation(): NotationFacts;
    /**
     * The document as MEI text — the score-based serialisation the pages are
     * engraved from and a converter reads (not the on-disk file, which may
     * carry a header the engraver does not). Null without a document. Added
     * 2026-09-16 for export producers: the formats plugin's three Verovio
     * exports are its first consumers.
     */
    mei(): string | null;
    /**
     * The id of the event at a caret position — a note, chord or rest — or
     * null when there is none (no document, an empty layer). Added
     * 2026-09-18 for the pitch reference's playhead, which follows the caret
     * to the same moment of the recording.
     */
    eventIdAt(caret: CaretPosition): string | null;
    /**
     * The document's measures in order, by their `xml:id` (null for a measure
     * that has none) — index i is the measure a caret's `measureIndex` i and a
     * tile's `measureIndex` i name. Empty without a document. Added 2026-10-11
     * (1.2.0) for the PDF reference, which matches annotated measures to the
     * score by id when it can and in order when it cannot.
     */
    measureIds(): (string | null)[];
}

// ---- formats.d.ts
/**
 * The `formats` point — the EXPORT half (slice 7a; imports come with
 * slice 8). A plugin DECLARES an export in its manifest and the host lists
 * it in the battuta menu before the plugin's code has loaded; picking it
 * fires `onFormat:<id>`, the plugin registers the producer, and the host
 * saves what it produces through its one export path (a browser
 * download, or the shell's save dialog). The same lesson as slot items
 * and lanes: an entry point cannot come from the code it loads.
 */
import type { Disposable } from "./disposable.js";
/** An export declared in the manifest (`contributes.exports`). Ids are global, like command ids: `<pluginId>.<name>`. */
export interface ExportContribution {
    id: string;
    /** The menu row reads "export <label> (.<ext>)". */
    label: string;
    /** File extension without the dot; the default file name is `<document>.<ext>`. */
    ext: string;
    /** MIME type of the saved file. */
    mime: string;
    /** Tooltip on the menu row. */
    title?: string;
}
/** One exported file: its bytes (or text), and its name when the default `<document>.<ext>` is not right. */
export interface ExportFile {
    bytes: Uint8Array | string;
    filename?: string;
}
/** What a producer returns: one file, or several (an SVG export writes a page per file). */
export type ExportPayload = ExportFile | {
    files: ExportFile[];
};
/**
 * An import declared in the manifest (`contributes.imports`): the file
 * extensions this converter claims. The host widens the open dialog's
 * accept list before the plugin's code loads; opening such a file fires
 * `onFormat:<id>`, the plugin registers the converter, and the MEI it
 * returns opens as a NEW unsaved document (a plain save must never
 * overwrite the source with MEI). Ids are global, like command ids.
 */
export interface ImportContribution {
    id: string;
    /** Shown in the open notice: "imported x.abc (<label> → MEI)". */
    label: string;
    /** Lower-case extensions without the dot. */
    exts: string[];
    /** The file is a container (a zip): hand the converter bytes, not text. */
    binary?: boolean;
    /**
     * For an extension MEI shares (`.xml`): the root element names that mark
     * a file as THIS format rather than MEI. Detection is the host's — a
     * plugin declares roots, never a sniffer.
     */
    roots?: string[];
}
/** What the host hands a converter: the file's name, and its text or — for a `binary` import — its bytes. */
export interface ImportFile {
    name: string;
    text?: string;
    bytes?: ArrayBuffer;
}
export interface FormatsService {
    /**
     * Provide the producer for an export this plugin DECLARED. Disposed with
     * the plugin (or by hand): the menu row stays (it is declared), and
     * picking it wakes the plugin again.
     */
    registerExport(id: string, produce: () => Promise<ExportPayload>): Disposable;
    /**
     * Provide the converter for an import this plugin DECLARED: the file in,
     * MEI text out (throw to refuse — the host shows the message). Disposed
     * with the plugin; the extensions stay accepted (they are declared) and
     * opening one wakes the plugin again.
     */
    registerImport(id: string, convert: (file: ImportFile) => Promise<string>): Disposable;
}

// ---- index.d.ts
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
export declare const API_VERSION = "1.3.12";
export type { ActivationEvent, HostCapability, SlotName, KeyboardLayout, CommandContribution, KeybindingContribution, SlotItemContribution, PluginContributions, PluginManifest } from "./manifest.js";
export { ACTIVATION_EVENT_PREFIXES, HOST_CAPABILITIES, SLOT_NAMES, validateManifest } from "./manifest.js";
export type { Disposable } from "./disposable.js";
export { toDisposable, DisposableStore } from "./disposable.js";
export type { Version } from "./semver.js";
export { parseVersion, satisfiesEngine } from "./semver.js";
export type { CaretPosition, BlockSelection, Pitch, PitchEvent, SylValue, HarmKind, NotationFacts, NoteMark, ClefContext, MeterContext, StaffContext, ViewMode, EditorState, DocumentInfo, DocumentQueries } from "./document.js";
export type { Timemap, TimemapEvent, TimemapNote } from "./render.js";
export type { AudioService } from "./audio.js";
export type { HighlightCue, ViewService } from "./view.js";
export type { OverlayBox, OverlayStaff, TileOverlayProps, OverlaySpec, OverlaysService, BandCell, OverlayBand, EndOverlayProps } from "./overlays.js";
export type { ExportContribution, ExportFile, ExportPayload, ImportContribution, ImportFile, FormatsService } from "./formats.js";
export type { DirEntry, WatchEvent, WatchEventKind, WorkspaceService } from "./workspace.js";
export type { StylusSample, StylusScorePoint, StylusEvent, StylusService, StylusSymbolContext, StylusRecognizeRequest, StylusRecognition, StylusReply, StylusTraining, StylusReplies } from "./stylus.js";
export type { KeyPress, KeysService } from "./keys.js";
export type { SetPitchesMessage, SetSylMessage, SetHarmMessage, EnterNoteMessage, AddChordNoteMessage, Mark, MarkMessage, EraseMessage, AppendMeasureMessage, CommandMessage, CommandMessageType } from "./messages.js";
export { COMMAND_MESSAGE_TYPES } from "./messages.js";
export type { MidiPort, MidiNoteEvent, MidiVirtualInput, MidiOutputs, MidiService } from "./midi.js";
export type { KeymapEntry, ActionsService } from "./actions.js";
export type { LanePlace, LaneContribution, LaneCommit, LaneCommitResult, LaneSpec, LanesService } from "./lanes.js";
export type { Store, SlotItem, PanelSide, PanelSpec, SettingsNamespace, StorageNamespace, CommandHandler, PluginContext, PluginModule, PluginEntry } from "./context.js";
export { definePlugin, resolvePluginModule } from "./context.js";

// ---- keys.d.ts
/**
 * Key presses as data (1.3.4, for the screencast keys plugin): every key
 * the editor's own key handler receives — the physical keyboard, not the
 * on-screen one, and never a key typed into a text field — with its
 * modifiers and the action it ran, so a plugin can show what was pressed
 * without listening to the page itself.
 */
import type { Disposable } from "./disposable.js";
export interface KeyPress {
    /** `KeyboardEvent.key`: what the key types on the user's layout — "a", "A", "4", "ArrowLeft", "Escape", " " … */
    key: string;
    /** `KeyboardEvent.code`: the physical key — "KeyA", "Digit4" … */
    code: string;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    /** The action the press ran — a keymap id (`tie`, `undo`, a plugin's command); its label is in `ctx.keymap` — or null when it ran none. */
    action: string | null;
}
export interface KeysService {
    /** Every key press, after the editor handled it; the disposable unsubscribes. */
    on(listener: (press: KeyPress) => void): Disposable;
}

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
import type { ExportContribution, ImportContribution } from "./formats.js";
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
export type HostCapability = "midi" | "workspace" | "audio" | "stylus";
export declare const HOST_CAPABILITIES: readonly HostCapability[];
/**
 * UI slots a plugin may place an item in. `header` is the first header row
 * (tabs, view toggle — where the plugins' own buttons go); `docHeader` the
 * second (title, tempo, and the player in page view — where a playback
 * plugin's controls go); `statusBar` the bottom bar; `menu` the battuta
 * menu; `pluginSettings` (1.3.11) the plugin's own row in the plugins page
 * (🌣 shortcuts → plugins), under its name — its settings and its state,
 * rendered by the plugin while it is active. Panels are a separate mechanism.
 */
export type SlotName = "header" | "docHeader" | "statusBar" | "menu" | "pluginSettings";
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
    /** Exports, listed in the battuta menu before the plugin loads; see formats.ts. */
    exports?: ExportContribution[];
    /** Imports: file extensions the open dialog accepts before the plugin loads; see formats.ts. */
    imports?: ImportContribution[];
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
    /**
     * False: the plugin starts off, until the user turns it on in the Plugins
     * tab — for a tool only some sessions want (1.3.4: the screencast keys).
     * Absent or true: on, as every plugin before it.
     */
    enabledByDefault?: boolean;
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
 * not one core's grammar accepts — `ctx.query.harmValid` asks the same
 * grammar, so a lane checks before it builds the message and a generator
 * filters before it writes. One undo step; byte-identical revert; labels
 * itself.
 */
export interface SetHarmMessage {
    type: "core.setHarm";
    eventId: string;
    kind: HarmKind;
    text: string;
}
/**
 * Enter a note at an event, as the keyboard does in entry mode (1.3.0, the
 * stylus): overwrite — the event (note, chord, rest or a measure rest)
 * becomes a note of this pitch and written duration; a shorter one leaves
 * rests for the rest of the time, a longer one takes the following events
 * of its layer. Refused when it would cross a beam, tuplet or barline.
 * The key signature supplies the accidental. One undo step; labels itself.
 * The caret goes to the note it wrote (1.3.3).
 */
export interface EnterNoteMessage {
    type: "core.enterNote";
    eventId: string;
    pname: string;
    oct: number;
    /** Written duration: "1" whole, "2" half, "4" quarter … "64". */
    dur: string;
    /** Dots: 0 (the default), 1 or 2. */
    dots?: number;
}
/**
 * Add a pitch to a note or a chord, as Shift + a letter does (1.3.2, the
 * stylus): a note becomes a chord of the two, a chord grows. Refused on a
 * rest, and for a pitch the chord already has. The key signature supplies
 * the accidental. One undo step; labels itself. The caret goes to the
 * chord (1.3.3).
 */
export interface AddChordNoteMessage {
    type: "core.addChordNote";
    eventId: string;
    pname: string;
    oct: number;
}
/**
 * A mark on an event, as the keyboard's keys put them (1.3.5, the stylus):
 * the accidental, articulation, dot, fermata, dynamic, fingering and pedal
 * keys on a note, chord or rest; a clef at the event's measure on its
 * staff; a rest entered over the event, as `core.enterNote` enters a note.
 * Each toggles as its key does: the same mark again takes it away.
 */
export type Mark = {
    kind: "accidental";
    accid: "s" | "f" | "n" | "x";
} | {
    kind: "articulation";
    artic: "stacc" | "ten" | "acc" | "stacciss" | "marc";
} | {
    kind: "dot";
} | {
    kind: "fermata";
}
/** The dynamic's text: "p", "mf", "sfz" … one to four letters. */
 | {
    kind: "dynamic";
    value: string;
} | {
    kind: "fingering";
    finger: "1" | "2" | "3" | "4" | "5";
}
/** A pedal from the event to `endId`, as the keyboard's pedal spans a selection; refused on one event alone. */
 | {
    kind: "pedal";
    endId: string;
}
/** G on the second line, F on the fourth, C on the third. */
 | {
    kind: "clef";
    shape: "G" | "F" | "C";
}
/** Written duration as `core.enterNote`'s; the rest replaces the event. */
 | {
    kind: "rest";
    dur: string;
    dots?: number;
}
/** An ornament by name (1.3.7), where the ornament key cycles them: the same one again takes it off, another replaces it. The arpeggio needs a chord. */
 | {
    kind: "ornament";
    ornament: "arpeg" | "trill" | "mordent" | "turn";
}
/** A repeat mark by name (1.3.8), where the coda key cycles them — the coda sign, "To Coda", the segno, Fine, D.S., D.C.: the same one again takes it off, another replaces it. */
 | {
    kind: "repeatMark";
    mark: "coda" | "toCoda" | "segno" | "fine" | "dalSegno" | "daCapo";
}
/** A tie from the event to `endId` (1.3.9), either order, as the tie key ties a note to its neighbour: the same pitch on both, consecutive in their layer — or every event between them a link of the chain, as the key does over a run. The same again unties. Refused across staves or layers, and where the pitches differ. */
 | {
    kind: "tie";
    endId: string;
}
/** A slur from the event to `endId` (1.3.9), either order, as the slur key spans a selection; the same again removes it. Notes and chords only. */
 | {
    kind: "slur";
    endId: string;
};
/**
 * Put a mark on an event (1.3.5, the stylus). One undo step; labels itself.
 * The caret goes to the event (to the rest, for a rest).
 */
export interface MarkMessage {
    type: "core.mark";
    eventId: string;
    mark: Mark;
}
/**
 * Erase what stands at `id` (1.3.7, the stylus's eraser): a note or a chord
 * — a chord's note names its chord — is deleted to rests, its time left as
 * rests the way the Delete key leaves it; a mark that stands on its own
 * (a dynamic, a fingering, a fermata, an ornament, a repeat mark —
 * `StylusScorePoint.nearestMark`) is removed whatever its state. A rest,
 * a pedal, and what is part of its note (an articulation, an accidental,
 * a dot: the same mark again takes it off) are refused. One undo step;
 * the caret goes to the rest that took the note's place, or to the event
 * the mark was on.
 */
export interface EraseMessage {
    type: "core.erase";
    id: string;
}
/**
 * A measure after the last (1.3.12): empty like its neighbour, as the
 * keyboard's ⊞+ adds one — at the end of the score, whatever the caret. The
 * caret goes to its first event, as to anything a plugin writes.
 */
export interface AppendMeasureMessage {
    type: "core.appendMeasure";
}
export type CommandMessage = SetPitchesMessage | SetSylMessage | SetHarmMessage | EnterNoteMessage | AddChordNoteMessage | MarkMessage | EraseMessage | AppendMeasureMessage;
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

// ---- overlays.d.ts
/**
 * The overlays extension point (slice 10a, 2026-09-18): what a plugin may
 * DRAW over the notation in edit view — a layer per measure tile, above
 * the score and below the host's own caret and selection, that never
 * touches the SVG. The host measures the tile for the plugin: the boxes of
 * its events and the lines of its staves with the context in force, all
 * in the tile's own CSS pixels (zoom applied), so a plugin maps a pitch or
 * a time to a place without knowing how Verovio laid the measure out.
 *
 * Draw-only: the layer takes no pointer events, so the host's hit-testing
 * underneath is untouched, and it sits over the SVG's own highlights, so
 * draw translucently. A plugin wanting a control puts it in a slot or a
 * panel. Time is not in here: the timemap (`ctx.query.timemap()`) names
 * each measure by the same engraved id, and its notes carry the pitches.
 *
 * A BAND (1.2.0, 2026-10-11, the PDF reference's facsimile): room ABOVE
 * each tile — "scan on top, rendering below". A plugin says how tall a
 * tile's band wants to be for the tile's width; the host reserves the
 * tallest of the row above every tile of that row (and an empty band
 * above the row's header cell), so a row's tiles stay level. Draw-only,
 * like the layer. Re-add the spec (same id) when what decides the heights
 * changes: the host re-measures bands when the specs change.
 */
import type { ReactNode } from "react";
import type { Disposable } from "./disposable.js";
import type { StaffContext } from "./document.js";
/** A box in the tile's CSS pixels: origin at the tile's top-left, zoom applied. */
export interface OverlayBox {
    x: number;
    y: number;
    width: number;
    height: number;
}
/** One staff of the tile: the y of each of its lines, top to bottom, and the context in force (clef, key, meter). */
export interface OverlayStaff {
    n: number;
    lines: readonly number[];
    context: StaffContext;
}
/** What the host hands an overlay for one tile — measured again whenever the tile is laid out again (a render, a zoom, a reflow). */
export interface TileOverlayProps {
    /** 0-based index of the measure the tile shows. */
    measureIndex: number;
    /** The measure's engraved id — what the timemap's `measureOn` names — or null when the measure carries none. */
    measureId: string | null;
    /** The tile's box; the layer covers exactly this area. */
    width: number;
    height: number;
    /** The engraved events in the tile (notes, chords, rests) → their box. A note's box is its HEAD (stem and flag excluded), so its centre is the pitch's place; a chord's notes are listed as well as the chord, since the timemap's pitches are per note. */
    boxes: Readonly<Record<string, OverlayBox>>;
    /** The tile's staves in staff order. */
    staves: readonly OverlayStaff[];
}
/** One tile's band cell, before the row's height is known. */
export interface BandCell {
    /** 0-based index of the measure the tile shows. */
    measureIndex: number;
    /** The measure's engraved id, or null when the measure carries none. */
    measureId: string | null;
    /** The tile's width in CSS px, zoom applied — the cell is exactly this wide. */
    width: number;
}
/** Room above every tile, for what belongs over a measure rather than on it. */
export interface OverlayBand {
    /** CSS px (zoom applied) this tile's band wants for its width; 0 for none. The host reserves the row's tallest. Called often — keep it arithmetic. */
    height: (cell: BandCell) => number;
    /** Draw one cell. `height` is the ROW's band height, at least this cell's own: align to the bottom to sit on the tile. */
    render: (cell: BandCell & {
        height: number;
    }) => ReactNode;
}
/**
 * The tile after the last measure (1.3.12): what the host gives an `end`
 * renderer — the box, and the staves as the last tile has them (the same
 * lines at the same heights, so a drawing of them lines up with the row).
 */
export interface EndOverlayProps {
    measureCount: number;
    width: number;
    height: number;
    staves: readonly OverlayStaff[];
}
export interface OverlaySpec {
    /** Unique within the plugin. Adding the same id again replaces the earlier overlay — and makes the host re-measure its band. */
    id: string;
    /** Render over one tile. Called for every rendered tile in edit view while the disposable lives; return null to draw nothing there. Optional since 1.2.0: a spec may be a band only. */
    render?: (tile: TileOverlayProps) => ReactNode;
    /** A band above every tile (1.2.0). */
    band?: OverlayBand;
    /** A tile after the last measure, in the last row of edit view (1.3.12): a place to add to the score from. Drawn while the disposable lives; the box is a typical tile's width by the row's height. */
    end?: (end: EndOverlayProps) => ReactNode;
}
export interface OverlaysService {
    /** Mount an overlay on every tile until disposed (or the plugin deactivates). */
    add(spec: OverlaySpec): Disposable;
}

// ---- render.d.ts
/**
 * What the host's RENDER service hands out about the document, as data:
 * Verovio's timemap. Rendering is a host service (tiles, pages, the
 * timemap), read-only to plugins — a player reads this and decides for
 * itself what to make of it; the host never says how a score is
 * performed.
 *
 * The timemap is of the EXPANDED form: repeats, voltas and one D.S./D.C.
 * jump are unrolled by core before Verovio sees the score, so a repeated
 * pass appears as CLONED ids (`<id>-rendN`) and `idMap` sends each clone
 * back to the engraved id the page SVG actually contains. Millisecond
 * stamps carry the score's own tempo already.
 */
/** One timemap entry: what turns on and off at a real-time millisecond stamp. */
export interface TimemapEvent {
    tstamp: number;
    on?: string[];
    off?: string[];
    /** The measure that starts here (engraved or cloned id), when one does. */
    measureOn?: string;
}
/** The sounding pitch (MIDI number, key signature and accidentals resolved) and written duration in ms of one id. */
export interface TimemapNote {
    pitch: number;
    duration: number;
}
export interface Timemap {
    events: TimemapEvent[];
    notes: Record<string, TimemapNote>;
    /** Cloned repeat-pass id → the engraved id. Absent for ids that are not clones. */
    idMap: Record<string, string>;
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

// ---- stylus.d.ts
/**
 * The stylus host service (capability "stylus", 1.3.0, 2026-10-29): the
 * Apple Pencil and the S Pen, captured natively by the iOS and Android
 * shells and handed to a plugin already read against the score.
 *
 * While capture is on, the pen writes ON THE SCORE and nowhere else (the
 * user's rule): a stroke that begins over the measures in edit view is the
 * plugin's, and the page never sees it; a stroke that begins anywhere else
 * — the toolbar, a panel, the on-screen keyboard, a menu open over the
 * score — taps like a finger. Fingers always scroll, zoom and tap.
 *
 * Every event carries `at`: where it falls on the score — the measure, the
 * nearest staff, the event (note, chord or rest) nearest the pen on that
 * staff, the height as steps above the staff's bottom line and the pitch
 * there under the clef in force, and the point in the tile's own pixels,
 * the frame the overlays point draws in. Null off the measures.
 */
import type { Disposable } from "./disposable.js";
import type { Pitch } from "./document.js";
/** One sample: page pixels, ms, pressure 0–1, altitude and azimuth in radians, roll (radians) where the pen reports it. */
export type StylusSample = readonly [x: number, y: number, t: number, pressure: number, altitude: number, azimuth: number, roll: number | null];
/** A page point read against the score in edit view. */
export interface StylusScorePoint {
    /** 0-based index of the measure under the point. */
    measureIndex: number;
    /** The staff nearest the point in that measure. */
    staffN: number;
    /** The event on that staff nearest the point across — what `core.enterNote` writes over; null on an empty staff. */
    eventId: string | null;
    /** Steps above the staff's bottom line: 0 the line, 1 the space above it, negative below. */
    step: number;
    /** The written pitch at that step under the clef in force — letter and octave; the key signature supplies its accidental. Null under a clef that names none. */
    pitch: Pitch | null;
    /** The point in the tile's own pixels — `TileOverlayProps`' frame, for drawing there. */
    tile: {
        x: number;
        y: number;
    };
    /** The staff's geometry in page px (1.3.5): the distance between two of its lines, and its middle line's y. */
    staff: {
        space: number;
        middleY: number;
    };
    /** The measure's barlines in page px (1.3.5): where the staff's lines begin and end. */
    measure: {
        left: number;
        right: number;
    };
    /** The note nearest the point within 8 staff spaces (1.3.5), by its body — its notehead, stem and flag; every head and the stem of its chord, for a chord's note; without accidentals, dots or articulations (1.3.8, as granita measures a note) — so a mark under a stem-down note finds it: the note's own id (a chord's note names itself, not the chord), its HEAD's centre in page px, where the pitch is, that body's `box` in page px (1.3.8), and its written `pitch` — a chord's note its own, with its accidental when written (1.3.9; null when the note has none). Null when none is that near. */
    nearestNote: {
        eventId: string;
        x: number;
        y: number;
        box: {
            left: number;
            top: number;
            right: number;
            bottom: number;
        };
        pitch: Pitch | null;
    } | null;
    /** The mark nearest the point within 8 staff spaces, by its engraving (1.3.7): one that stands on its own beside its event — a dynamic, a fingering, a fermata, an ornament (trill, mordent, turn, arpeggio) or a repeat mark — with its id, which `core.erase` takes, and its centre in page px. Not a pedal, nor an articulation, accidental or dot, which are part of their note. Null when none is that near. */
    nearestMark: {
        id: string;
        kind: "dynamic" | "fingering" | "fermata" | "ornament" | "repeatMark";
        x: number;
        y: number;
    } | null;
}
export type StylusEvent = 
/** A stroke: samples batched once per screen frame, `down` first; `at` is its last sample's place. `predicted` are the system's guesses ahead (iPadOS). */
{
    type: "stroke";
    phase: "down" | "move" | "up" | "cancel";
    id: number;
    samples: readonly StylusSample[];
    predicted: readonly StylusSample[];
    at: StylusScorePoint | null;
}
/** The pen held still where stroke `id` landed — within 8 px for half a second. Sent once; the stroke's `up` ends it. */
 | {
    type: "hold";
    id: number;
    x: number;
    y: number;
    at: StylusScorePoint | null;
}
/** The pen above the glass, height 0–1. */
 | {
    type: "hover";
    phase: "enter" | "move" | "leave";
    x: number;
    y: number;
    height: number;
    at: StylusScorePoint | null;
}
/** The Pencil Pro's squeeze (down, up) and double-tap (tap); the S Pen's side button (down, up). Where the pen was, when the system says. */
 | {
    type: "button";
    button: "squeeze" | "doubleTap" | "side";
    phase: "down" | "up" | "tap";
    x: number | null;
    y: number | null;
    height: number | null;
    at: StylusScorePoint | null;
};
/**
 * Where a symbol sits, in staff spaces — granita's `SymbolContext`, which the
 * shell turns into the model's vector (1.3.5). Everything in it comes from a
 * `StylusScorePoint`: the staff, the measure and the nearest note's body.
 */
export interface StylusSymbolContext {
    /** The symbol's centre from the staff's middle line; down is positive. */
    yStaff: number;
    /** 0 at the left barline, 1 at the right. */
    xMeasure: number;
    /** Distance to the nearest barline. */
    barline: number;
    /** The centre minus the centre of the nearest note's body (`nearestNote.box`, 1.3.8; its head before); null with no note within 8 spaces. */
    noteDx: number | null;
    noteDy: number | null;
    /** That body's width and height (1.3.8); null with no note. */
    noteW: number | null;
    noteH: number | null;
    /** The symbol's box. */
    width: number;
    height: number;
}
/** A symbol to read (1.3.5): its strokes in page px, the staff space in page px, and where it sits — null when unknown, which the model was trained for too. */
export interface StylusRecognizeRequest {
    strokes: readonly (readonly (readonly [x: number, y: number])[])[];
    staffSpace: number;
    context: StylusSymbolContext | null;
}
/** One of the classifier's answers (1.3.5): a class of granita's sidecar and its confidence, 0–1. */
export interface StylusRecognition {
    label: string;
    confidence: number;
}
/**
 * A handwritten symbol with the class the user confirmed (1.3.10): what
 * `ctx.stylus.reply` saves for the dataset — the shell writes musicset's
 * contribution record (label, writer, staff space, the strokes with their
 * times and pressures, the context, what the classifier read) to its replies
 * file. A label a person chose: ✓ tapped, a choice picked — never a silence.
 */
export interface StylusReply {
    /** granita's class the user confirmed. */
    label: string;
    /** The symbol's strokes as the pen gave them: every sample, time and pressure included. */
    strokes: readonly (readonly StylusSample[])[];
    staffSpace: number;
    context: StylusSymbolContext | null;
    /** What the classifier read first, before the user replied; null when it read nothing. */
    read: StylusRecognition | null;
}
/** What `ctx.stylus.train` did (1.3.10). */
export interface StylusTraining {
    /** Replies on the device, and how many the replay buffer took (the newest few of each class). */
    replies: number;
    buffer: number;
    /** The anchors the layer was held to. */
    anchors: number;
    /** Mean cross-entropy over the buffer, the share of it the trained layer gets right, and the mean drift from the original layer's answers on the anchors. */
    loss: number;
    accuracy: number;
    drift: number;
}
/** The replies on the device and the layer in use (`ctx.stylus.replies`, 1.3.11). */
export interface StylusReplies {
    /** Replies kept on the device, and how many the replay buffer would take of them (the newest few of each class the classifier knows). */
    replies: number;
    buffer: number;
    /** The last training, while its layer is in use; null with the released classifier. */
    training: StylusTraining | null;
}
export interface StylusService {
    /** True in the iOS and Android shells, which capture the stylus; false on the desktop and in a browser — do nothing there. */
    readonly available: boolean;
    /** Take the pen's strokes on the score (on) or give them back (off). Off again when the plugin deactivates. */
    capture(on: boolean): Promise<void>;
    /** Every event while capture is on; the disposable unsubscribes. */
    on(listener: (event: StylusEvent) => void): Disposable;
    /** Where a page point falls on the score, read as the events' `at` are (1.3.5). Null off the measures, with no document open, and before the service has loaded — it loads with the first `capture` or `on`. */
    at(x: number, y: number): StylusScorePoint | null;
    /** The shell's classifier, granita, on a symbol (1.3.5): its classes by confidence, best first. Rejects on the desktop and in a shell without the model. */
    recognize(request: StylusRecognizeRequest): Promise<readonly StylusRecognition[]>;
    /** Save a confirmed symbol for the dataset (1.3.10): the shell appends musicset's record to its replies file; resolves to the replies it holds. */
    reply(reply: StylusReply): Promise<number>;
    /** Retrain the classifier's last layer on the device from every reply (1.3.10): a small replay buffer of them, held to the model's anchors and its original weights. The trained layer is kept and `recognize` uses it from then on, until `resetTraining`. */
    train(): Promise<StylusTraining>;
    /** The original layer back, the trained one forgotten (1.3.10). */
    resetTraining(): Promise<void>;
    /** The replies file handed to the system share sheet (1.3.10); true when the user sent it somewhere. */
    shareReplies(): Promise<boolean>;
    /** The replies on the device, how many the buffer would take, and the training in use (1.3.11). Rejects where there is no stylus shell. */
    replies(): Promise<StylusReplies>;
    /** Every reply on the device deleted; the layer in use is left alone — `resetTraining` for that (1.3.11). */
    deleteReplies(): Promise<void>;
}

// ---- view.d.ts
/**
 * The view host service: what a plugin may do to the NOTATION on screen.
 * Today, one thing — light events in page view as they sound, following
 * the music when the playing measure leaves the window. The host owns the
 * SVG; a plugin names ids (engraved ones — the page contains no clones).
 */
export interface HighlightCue {
    /** Engraved ids to light now. */
    on: readonly string[];
    /** Engraved ids to unlight now. */
    off: readonly string[];
    /** The measure starting now: the view scrolls to it when it is off screen. */
    measureOn?: string;
}
export interface ViewService {
    /** Apply one cue. A no-op in tile view and with no document open. */
    highlight(cue: HighlightCue): void;
    /** Unlight everything — stop, seek, an edit. */
    clearHighlight(): void;
}

// ---- workspace.d.ts
/**
 * The workspace host service (capability "workspace"): the folders the
 * user opened and the files in them — a platform capability with a shell
 * backend (Tauri commands behind this facade) and a browser backend that
 * reports itself unavailable. Slice 9a, 2026-09-16.
 *
 * SCOPED: only folders the user picked (or a plugin re-admitted from an
 * earlier session with `openFolder`) can be listed, read, watched or
 * written in; the shell refuses everything outside them. The writes
 * (1.1.0, 2026-10-11, the folder view's) are `rename` in place and
 * `createFolder` / `createFile`, which are create-only: nothing here
 * overwrites, deletes or moves between folders, and an existing file's
 * contents are written only by the host's save path.
 */
import type { Disposable } from "./disposable.js";
export interface DirEntry {
    name: string;
    /** Absolute path, the form every other call here takes. */
    path: string;
    kind: "file" | "dir";
}
export type WatchEventKind = "created" | "modified" | "removed";
export interface WatchEvent {
    path: string;
    kind: WatchEventKind;
}
export interface WorkspaceService {
    /** False in a browser build: tell the user the shell is required, and do nothing else. */
    readonly available: boolean;
    /** The native folder dialog — on a tablet, the system's folder picker (Files and iCloud Drive on an iPad, any storage on Android). The picked folder becomes readable; null when cancelled or unavailable. */
    pickFolder(): Promise<string | null>;
    /**
     * The platform's own folder for scores, readable like a picked one — on a
     * tablet, battuta's folder: the app's Documents, where a new score's first
     * save goes ("On My iPad › battuta" in the Files app). Null where there is
     * none: the desktop app (its folders are the user's) and a browser.
     * Added in 1.2.0 for the folder view on tablets (phase 10).
     */
    home(): Promise<string | null>;
    /** Re-admit a folder picked in an earlier session (a plugin persists the path). False when it no longer exists or the shell is unavailable. */
    openFolder(path: string): Promise<boolean>;
    /** The entries of a folder inside a picked root: folders first, then files, hidden entries skipped. Rejects outside the roots. */
    readDir(path: string): Promise<DirEntry[]>;
    /** Open a score through the host's open path: imports convert, the tab is focused if it is already open. Rejects outside the roots. */
    openDocument(path: string): Promise<void>;
    /** Watch a folder (recursively) inside a picked root; events are coalesced per path. Dispose to stop. A no-op disposable when unavailable. */
    watch(path: string, listener: (event: WatchEvent) => void): Disposable;
    /**
     * Rename a file or folder in place — `newName` is a name, never a path —
     * and resolve with its new path. Rejects with the reason: an empty or
     * dot-led name, a separator in it, a name that already exists there, a
     * picked root itself, anything outside the roots, or no shell. The host
     * follows the rename: an open document at (or, for a folder, under) the
     * old path takes the new one, so it saves where the file now is, and a
     * renamed file's tab takes its new name. Added in 1.1.0 for the folder
     * view.
     */
    rename(path: string, newName: string): Promise<string>;
    /**
     * Create an empty folder named `name` in the folder `dir` (a picked root
     * or a folder under one) and resolve with its path. Rejects with the
     * reason: a name refused as `rename` refuses it, a name that already
     * exists, `dir` outside the roots or not a folder, or no shell. Added in
     * 1.1.0 for the folder view.
     */
    createFolder(dir: string, name: string): Promise<string>;
    /**
     * Create a NEW file named `name` in `dir` with `contents` (UTF-8 text)
     * and resolve with its path. Create-only: an existing name is refused,
     * never overwritten — writing an existing file is the host's save path,
     * not this. Rejections as `createFolder`. Added in 1.1.0 for the folder
     * view's new score; open the result with `openDocument`.
     */
    createFile(dir: string, name: string, contents: string): Promise<string>;
}

// ---- re-exported from @battuta/core (declared there; printed here so the pin covers the shape)
// BlockSelection — from packages/core/dist/clipboard.d.ts
export interface BlockSelection {
    measureFrom: number;
    measureTo: number;
    staffFrom: number;
    staffTo: number;
}
// CaretPosition — from packages/core/dist/events.d.ts
export interface CaretPosition {
    measureIndex: number;
    staffN: number;
    layerN: number;
    /** Index of the event the caret is on, within its layer. */
    eventIndex: number;
}
// ClefContext — from packages/core/dist/context.d.ts
export interface ClefContext {
    shape: string;
    line: number;
    /** Octave displacement (8, 15) and its direction, e.g. G-clef ottava bassa. */
    dis?: number;
    disPlace?: "above" | "below";
}
// HarmKind — from packages/core/dist/harm.d.ts
export type HarmKind = "chord" | "rna";
// MeterContext — from packages/core/dist/context.d.ts
export interface MeterContext {
    count?: string;
    unit?: string;
    sym?: string;
}
// NotationFacts — from packages/core/dist/playback.d.ts
export interface NotationFacts {
    /** noteId -> the note it ties INTO (chains resolve link by link). */
    ties: Record<string, string>;
    /** noteId -> its marks, in this order: the note's own (or its chord's) articulations, then `slur` when a slur or phrase spans it. */
    marks: Record<string, NoteMark[]>;
}
// NoteMark — from packages/core/dist/playback.d.ts
export type NoteMark = "slur" | "tenuto" | "staccato" | "staccatissimo";
// Pitch — from packages/core/dist/pitches.d.ts
export interface Pitch {
    pname: string;
    oct: number;
    accid?: string;
    accidGes?: string;
}
// PitchEvent — from packages/core/dist/pitches.d.ts
export interface PitchEvent {
    eventId: string;
    pitches: Pitch[];
}
// StaffContext — from packages/core/dist/context.d.ts
export interface StaffContext {
    n: number;
    lines: number;
    clef: ClefContext;
    /** MEI keysig value: "0", "3s", "2f", … */
    keysig: string;
    meter: MeterContext;
    /** Chromatic/diatonic transposition of a transposing staff, if any. */
    transSemi?: number;
    transDiat?: number;
}
// SylValue — from packages/core/dist/lyrics.d.ts
export interface SylValue {
    text: string;
    /** i = word start, m = middle, t = end; absent = whole word. */
    wordpos?: string;
    /** "d" = hyphen continues to the next syllable. */
    con?: string;
}
