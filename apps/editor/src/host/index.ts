/**
 * The host: what App.tsx is becoming. One object wiring the reactive
 * keymap, the UI slots and panels, the plugin registry with its command
 * table, and the services plugins see through their context (notices,
 * confirm, settings, storage, the read-only document and editor-state
 * mirrors, `execute`).
 *
 * `host` is a module singleton created at import (registering the
 * built-in plugins unless the URL says ?plugins=off); `createHost` is
 * exported for tests, which pass memory-backed settings and storage.
 */
import { API_VERSION, DisposableStore, type ActionsService, type ActivationEvent, type BlockSelection, type CommandMessage, type DocumentInfo, type DocumentQueries, type EditorState, type HostCapability, type KeymapEntry, type PitchEvent, type PluginContext, type PluginEntry, type PluginManifest, type Store, type SylValue, type HarmKind, type NotationFacts, type Timemap, type ViewMode, type ViewService, type CaretPosition } from "@battuta/api";
import { isHarmText, type Command } from "@battuta/core";
import { toCommand } from "./messages";
import { keyMatches, type Layout } from "../keymap";
import { detectLayout } from "../settings";
import { KeymapStore } from "./keymapStore";
import { SlotStore, PanelStore } from "./slots";
import { CommandTable, PluginRegistry, type KeyLike } from "./registry";
export type { KeyLike } from "./registry";
import { confirmDialog } from "./shell";
import { createStore, mapStore, type WritableStore } from "./store";
import { ActionTable } from "./actions";
import { isPluginEnabled, memorySettings, pluginSettings, pluginStorage, setPluginEnabled, webSettings, webStorage, type Notice, type SettingsIO, type StorageLike } from "./services";
import { BUILTIN_PLUGINS } from "./plugins";
import { HostMidiService, detectMidiBackend } from "./midi";
import { LaneStore } from "./lanes";
import { OverlayStore } from "./overlays";
import { HostAudioService } from "./audio";
import { FormatStore } from "./formats";
import { HostWorkspaceService, detectWorkspaceBridge, type WorkspaceAdapter } from "./workspace";

/** Capabilities this host offers: `midi` since slice 3, `audio` since 7a, `workspace` since 9a (every build offers it; `ctx.workspace.available` says whether the shell is there). */
export const OFFERED_CAPABILITIES: readonly HostCapability[] = ["midi", "audio", "workspace"];

const IDLE_EDITOR: EditorState = { caret: null, selection: [], block: null, view: "tiles", entryMode: false };


/**
 * What the App binds for the active document: the executor (one undo
 * step, the same afterCommand as every core edit) and the answers to the
 * query facade. Null while no document is open.
 */
export interface SessionAdapter {
  execute(command: Command): void;
  pitchEventsIn(block: BlockSelection): PitchEvent[][];
  blockOf(eventIds: readonly string[]): BlockSelection | null;
  lyricAt(eventId: string): SylValue | null;
  harmAt(eventId: string, kind: HarmKind): string;
  /** The id of the event at a caret position, or null. */
  eventIdAt(caret: CaretPosition): string | null;
  /** Verovio's timemap of the expanded form — a render service; rejects with the render error. */
  timemap(): Promise<Timemap>;
  /** The notation facts a performance interprets. */
  notation(): NotationFacts;
  /** The document as MEI text, score-based (what the pages are engraved from and converters read). */
  mei(): string;
}

/**
 * What the App binds for the notation on screen: lighting engraved ids in
 * page view as they sound. Null while nothing is mounted (or in tests):
 * the view service is then a no-op.
 */
export type ViewAdapter = ViewService;

export interface Host {
  readonly apiVersion: string;
  /** True when the URL carried ?plugins=off: nothing was registered. */
  readonly noPlugins: boolean;
  readonly keymap: KeymapStore;
  /** The keymap as data, for plugins (what ctx.keymap hands out). */
  readonly keymapView: Store<readonly KeymapEntry[]>;
  /** The host's actions by id: the App installs the table, plugins run ids through ctx.actions. */
  readonly actions: ActionTable;
  readonly slots: SlotStore;
  readonly panels: PanelStore;
  /** Text lanes at the caret: the App binds its adapter and registers its internal lanes; plugins declare and register theirs. */
  readonly lanes: LaneStore;
  /** The overlays point: what plugins draw over every measure tile in edit view (the tile grid mounts `<TileOverlays>` per tile). */
  readonly overlays: OverlayStore;
  readonly registry: PluginRegistry;
  readonly commands: CommandTable;
  readonly notices: Store<Notice | null>;
  /** The MIDI host service: devices, the note stream, virtual inputs, outputs. The App starts it. */
  readonly midi: HostMidiService;
  /** The audio host service: the app's one AudioContext. */
  readonly audio: HostAudioService;
  /** The notation on screen, as plugins may touch it (highlight); answered by the bound view adapter. */
  readonly view: ViewService;
  /** Formats, both halves: the App registers its own exports and imports, plugins declare and register theirs; the menu lists `formats.exports`, the open dialog accepts `formats.openExtensions`. */
  readonly formats: FormatStore;
  /** The workspace host service: the folders the user opened, scoped; unavailable in a browser. The App binds the opener. */
  readonly workspace: HostWorkspaceService;
  /** Mirrors the App keeps current; plugins read them through their context. */
  readonly document: WritableStore<DocumentInfo | null>;
  /** Every open document in tab order (the active one is `document`). */
  readonly documents: WritableStore<readonly DocumentInfo[]>;
  readonly editor: WritableStore<EditorState>;
  /** The query facade plugins see; answered by the bound session adapter. */
  readonly query: DocumentQueries;
  notice(text: string): void;
  confirm(message: string, title?: string): Promise<boolean>;
  /** The App installs the active session's adapter; null while no document is open. */
  bindSession(adapter: SessionAdapter | null): void;
  /** The App installs what lights the page view; null while it has no notation on screen. */
  bindView(adapter: ViewAdapter | null): void;
  /** The App installs how a path opens (through its one open path); null while it cannot. */
  bindWorkspace(adapter: WorkspaceAdapter | null): void;
  /** Commands as data: the message becomes a core command here, never in a plugin. */
  execute(message: CommandMessage): void;
  /** Plugin keybindings: called by the App's key handler AFTER the core dispatcher falls through. */
  dispatchKey(e: KeyLike): boolean;
  fire(event: ActivationEvent): Promise<void>;
  /** onStartup, then onPointer:coarse on a touch device, then onSettings:<key> per plugin whose own setting is truthy. */
  fireStartupEvents(opts: { coarsePointer: boolean }): Promise<void>;
  dispose(): Promise<void>;
}

export interface HostOptions {
  layout?: Layout;
  noPlugins?: boolean;
  plugins?: readonly PluginEntry[];
  settings?: SettingsIO;
  storage?: StorageLike;
  confirm?: (message: string, title?: string) => Promise<boolean>;
  apiVersion?: string;
  /** Tests inject a service over a fake backend; the app detects Web MIDI or the shell. */
  midi?: HostMidiService;
  /** Tests inject a service over a fake AudioContext; the app creates the real one on first unlock. */
  audio?: HostAudioService;
  /** Tests inject a service over a fake shell bridge; the app detects the shell or reports unavailable. */
  workspace?: HostWorkspaceService;
  /** Tests narrow what the host offers, to exercise the refusal; the app offers OFFERED_CAPABILITIES. */
  capabilities?: readonly HostCapability[];
}

export function createHost(options: HostOptions = {}): Host {
  const settings = options.settings ?? webSettings;
  const storage = options.storage ?? webStorage();
  const confirm = options.confirm ?? confirmDialog;
  const layout = options.layout ?? settings.load().layout ?? detectLayout();
  const noPlugins = options.noPlugins ?? false;

  const keymap = new KeymapStore(layout);
  const keymapView = mapStore(keymap, (map): readonly KeymapEntry[] =>
    Object.entries(map).map(([id, b]) => ({
      id,
      label: b.label,
      group: b.group,
      ...(b.when !== undefined ? { when: b.when } : {}),
      keys: [...b.keys],
      ...(b.shift !== undefined ? { shift: b.shift } : {}),
      ...(b.alt !== undefined ? { alt: b.alt } : {}),
      locked: Boolean(b.locked),
      ...(b.plugin !== undefined ? { plugin: b.plugin } : {}),
    })),
  );
  // Declared before the registry exists: the fallbacks look it up lazily.
  let registryRef: PluginRegistry | null = null;
  const actions = new ActionTable({
    key: (e) => registryRef?.dispatchKeyFor(keymap, e) ?? false,
    run: (id) => {
      if (!registryRef || commands.ownerOf(id) === undefined) return false;
      void registryRef.runCommand(id);
      return true;
    },
  });
  // Every id run() knows: the installed core rules, then every enabled
  // plugin's declared commands — republished when the App installs a table
  // (a document opens) and when a plugin is turned on or off.
  const actionIds = createStore<readonly string[]>([]);
  const publishIds = () => actionIds.set([...actions.ruleIds.get(), ...commands.declared()]);
  actions.ruleIds.subscribe(publishIds);
  const actionsService: ActionsService = { run: (id) => actions.run(id), ids: actionIds };
  const slots = new SlotStore();
  const panels = new PanelStore();
  const overlays = new OverlayStore();
  const commands = new CommandTable();
  const notices = createStore<Notice | null>(null);
  const midi = options.midi ?? new HostMidiService(detectMidiBackend());
  const audio = options.audio ?? new HostAudioService();
  const workspace = options.workspace ?? new HostWorkspaceService(detectWorkspaceBridge());
  let seq = 0;
  const notice = (text: string) => notices.set({ text, seq: ++seq });
  /** An empty text clears the notice (the App maps "" to none). */
  const noticeOrClear = (text: string | null) => notices.set({ text: text ?? "", seq: ++seq });
  const document = createStore<DocumentInfo | null>(null);
  const documents = createStore<readonly DocumentInfo[]>([]);
  const editor = createStore<EditorState>(IDLE_EDITOR);
  let adapter: SessionAdapter | null = null;
  const execute = (message: CommandMessage) => {
    if (!adapter) throw new Error("no document is open");
    adapter.execute(toCommand(message));
  };
  const query: DocumentQueries = {
    pitchEventsIn: (block) => adapter?.pitchEventsIn(block) ?? [],
    blockOf: (ids) => adapter?.blockOf(ids) ?? null,
    lyricAt: (id) => adapter?.lyricAt(id) ?? null,
    harmAt: (id, kind) => adapter?.harmAt(id, kind) ?? "",
    harmValid: (kind, text) => isHarmText(kind, text), // core's grammar; a question about text, not about a document
    timemap: () => (adapter ? adapter.timemap() : Promise.resolve(null)),
    notation: () => adapter?.notation() ?? { ties: {}, marks: {} },
    mei: () => adapter?.mei() ?? null,
    eventIdAt: (caret) => adapter?.eventIdAt(caret) ?? null,
  };
  let viewAdapter: ViewAdapter | null = null;
  const view: ViewService = {
    highlight: (cue) => viewAdapter?.highlight(cue),
    clearHighlight: () => viewAdapter?.clearHighlight(),
  };
  const formats = new FormatStore({
    activate: (exportId, pluginId) => registryRef?.activate(pluginId, `onFormat:${exportId}`) ?? Promise.resolve(false),
  });
  const lanes = new LaneStore({
    execute,
    notice: noticeOrClear,
    activate: (laneId, pluginId) => registryRef?.activate(pluginId, `onLane:${laneId}`) ?? Promise.resolve(false),
  });
  lanes.watch(editor, document);

  const createContext = (manifest: PluginManifest, subscriptions: DisposableStore, activatedBy: ActivationEvent | null): PluginContext => ({
    manifest,
    apiVersion: options.apiVersion ?? API_VERSION,
    activatedBy,
    document,
    documents,
    editor,
    query,
    execute,
    registerCommand: (id, handler) => subscriptions.add(commands.setHandler(id, manifest.id, handler)),
    notice,
    confirm,
    settings: pluginSettings(settings, manifest.id),
    storage: pluginStorage(storage, manifest.id),
    midi,
    keymap: keymapView,
    actions: actionsService,
    slots: { add: (slot, item) => subscriptions.add(slots.add(slot, item, manifest.id)) },
    panels: { open: (panel) => subscriptions.add(panels.open(panel)) },
    overlays: { add: (spec) => subscriptions.add(overlays.add(spec, manifest.id)) },
    lanes: {
      register: (spec) => {
        if (!manifest.contributes?.lanes?.some((l) => l.id === spec.id)) throw new Error(`plugin ${manifest.id} did not declare lane ${spec.id} in its manifest`);
        return subscriptions.add(lanes.register(spec, manifest.id));
      },
      open: (id) => lanes.open(id),
    },
    audio,
    view,
    workspace,
    formats: {
      registerExport: (id, produce) => {
        if (!manifest.contributes?.exports?.some((x) => x.id === id)) throw new Error(`plugin ${manifest.id} did not declare export ${id} in its manifest`);
        return subscriptions.add(formats.registerExport(id, produce, manifest.id));
      },
      registerImport: (id, convert) => {
        if (!manifest.contributes?.imports?.some((x) => x.id === id)) throw new Error(`plugin ${manifest.id} did not declare import ${id} in its manifest`);
        return subscriptions.add(formats.provideImport(id, convert, manifest.id));
      },
    },
    subscriptions,
  });

  const registry = new PluginRegistry({
    ...(options.apiVersion !== undefined ? { apiVersion: options.apiVersion } : {}),
    capabilities: options.capabilities ?? OFFERED_CAPABILITIES,
    isEnabled: (id) => isPluginEnabled(settings, id),
    persistEnabled: (id, on) => setPluginEnabled(settings, id, on),
    contributeKeybindings: (pluginId, bindings) => keymap.contribute(pluginId, bindings),
    declareSlotItems: (pluginId, items) => {
      const store = new DisposableStore();
      for (const item of items) store.add(slots.declare({ ...item, pluginId }));
      return store;
    },
    declareLanes: (pluginId, contributed) => {
      const store = new DisposableStore();
      for (const lane of contributed) store.add(lanes.declare({ ...lane, pluginId }));
      return store;
    },
    declareExports: (pluginId, contributed) => {
      const store = new DisposableStore();
      for (const entry of contributed) store.add(formats.declare({ ...entry, pluginId }));
      return store;
    },
    declareImports: (pluginId, contributed) => {
      const store = new DisposableStore();
      for (const entry of contributed) store.add(formats.declareImport({ ...entry, pluginId }));
      return store;
    },
    commands,
    createContext,
    report: notice,
    keyMatches: (b, e) => keyMatches(b, e),
  });

  registryRef = registry;
  registry.subscribe(publishIds); // a plugin on or off changes the command set
  if (!noPlugins) for (const entry of options.plugins ?? []) registry.register(entry);
  publishIds();

  const dispatchKey = (e: KeyLike): boolean => registry.dispatchKeyFor(keymap, e);

  // `onView:<mode>` fires on every change of the editor mirror's view —
  // and for the first view published, so a plugin that declares
  // `onView:tiles` wakes at startup too. Reserved since slice 1; fired
  // since 7a for the player row (`onView:pages`).
  let firedView: ViewMode | null = null;
  editor.subscribe((state) => {
    if (state.view === firedView) return;
    firedView = state.view;
    void registry.fire(`onView:${state.view}`);
  });

  /**
   * The startup activation events, in order: onStartup for everyone who
   * asked; onPointer:coarse on a touch-first device; then, per plugin,
   * `onSettings:<key>` for each such event it declared whose key holds a
   * truthy value in its OWN settings — "you were in use when I last quit".
   */
  const fireStartupEvents = async (opts: { coarsePointer: boolean }): Promise<void> => {
    await registry.fire("onStartup");
    if (opts.coarsePointer) await registry.fire("onPointer:coarse");
    for (const info of registry.get()) {
      if (!info.enabled || info.state !== "registered") continue;
      const mine = pluginSettings(settings, info.id);
      for (const event of info.manifest.activationEvents) {
        if (!event.startsWith("onSettings:")) continue;
        if (mine.get(event.slice("onSettings:".length))) await registry.activate(info.id, event);
      }
    }
  };

  return {
    apiVersion: options.apiVersion ?? API_VERSION,
    noPlugins,
    keymap,
    keymapView,
    actions,
    slots,
    panels,
    lanes,
    overlays,
    registry,
    commands,
    notices,
    midi,
    audio,
    view,
    formats,
    workspace,
    document,
    documents,
    editor,
    query,
    notice,
    confirm,
    bindSession: (next) => {
      adapter = next;
    },
    bindView: (next) => {
      viewAdapter = next;
    },
    bindWorkspace: (next) => workspace.bind(next),
    execute,
    dispatchKey,
    fire: (event) => registry.fire(event),
    fireStartupEvents,
    dispose: () => registry.dispose(),
  };
}

const detectNoPlugins = (): boolean => {
  try {
    return typeof location !== "undefined" && new URLSearchParams(location.search).get("plugins") === "off";
  } catch {
    return false;
  }
};

/** True on a touch-first device: the host fires onPointer:coarse for plugins that open by themselves there (the on-screen keyboard). */
const coarsePointer = (): boolean => {
  try {
    return typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
};

/** The application's host. Built-in plugins registered; the startup events fired: onStartup, then onPointer:coarse on a touch device. */
export const host: Host = createHost({ noPlugins: detectNoPlugins(), plugins: BUILTIN_PLUGINS });
void host.fireStartupEvents({ coarsePointer: coarsePointer() });
if (typeof window !== "undefined" && (import.meta.env.DEV || "__TAURI__" in window)) (window as unknown as Record<string, unknown>).__HOST__ = host;

export { memorySettings };
export type { PluginInfo, PluginState } from "./registry";
export { useStore } from "./store";
export { Slot, Panels, SIDE_PANEL_WIDTH } from "./slots";
export { LaneStore, LaneInput, laneFace } from "./lanes";
export type { LaneAdapter, LaneState, LaneOption, DeclaredLane } from "./lanes";
export { OverlayStore, TileOverlays, tileGeometry, measureTile } from "./overlays";
export type { RegisteredOverlay, TileMeasurement, Rect } from "./overlays";
export { HostAudioService } from "./audio";
export type { AudioContextFactory } from "./audio";
export { FormatStore } from "./formats";
export { HostWorkspaceService, detectWorkspaceBridge } from "./workspace";
export type { WorkspaceBridge, WorkspaceAdapter } from "./workspace";
export type { DeclaredExport, DeclaredImport, ExportOption, ImportOption, Producer, Converter } from "./formats";
export { blockOfEvents } from "./queries";
export { toCommand } from "./messages";
export { HostMidiService, webMidiBackend, shellMidiBackend, noMidiBackend, detectMidiBackend, parseNoteMessage } from "./midi";
export type { MidiBackend } from "./midi";
export { MidiSink, NOTE_ON, NOTE_OFF } from "./midiSink";
export { ActionTable, rule, gate, modal, isMod } from "./actions";
export type { ActionStep, ActionRule, KeyEvent, Outcome } from "./actions";
export { confirmDialog, tauriInvoke } from "./shell";
