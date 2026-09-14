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
import { API_VERSION, DisposableStore, type ActionsService, type ActivationEvent, type BlockSelection, type CommandMessage, type DocumentInfo, type DocumentQueries, type EditorState, type HostCapability, type KeymapEntry, type PitchEvent, type PluginContext, type PluginEntry, type PluginManifest, type Store, type SylValue } from "@battuta/api";
import type { Command } from "@battuta/core";
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

/** Capabilities this host offers. `midi` since slice 3; `workspace` and `playback` are still to be lifted. */
export const OFFERED_CAPABILITIES: readonly HostCapability[] = ["midi"];

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
}

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
  readonly registry: PluginRegistry;
  readonly commands: CommandTable;
  readonly notices: Store<Notice | null>;
  /** The MIDI host service: devices, the note stream, virtual inputs, outputs. The App starts it. */
  readonly midi: HostMidiService;
  /** Mirrors the App keeps current; plugins read them through their context. */
  readonly document: WritableStore<DocumentInfo | null>;
  readonly editor: WritableStore<EditorState>;
  /** The query facade plugins see; answered by the bound session adapter. */
  readonly query: DocumentQueries;
  notice(text: string): void;
  confirm(message: string, title?: string): Promise<boolean>;
  /** The App installs the active session's adapter; null while no document is open. */
  bindSession(adapter: SessionAdapter | null): void;
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
  const commands = new CommandTable();
  const notices = createStore<Notice | null>(null);
  const midi = options.midi ?? new HostMidiService(detectMidiBackend());
  let seq = 0;
  const notice = (text: string) => notices.set({ text, seq: ++seq });
  /** An empty text clears the notice (the App maps "" to none). */
  const noticeOrClear = (text: string | null) => notices.set({ text: text ?? "", seq: ++seq });
  const document = createStore<DocumentInfo | null>(null);
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
  };
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
    lanes: {
      register: (spec) => {
        if (!manifest.contributes?.lanes?.some((l) => l.id === spec.id)) throw new Error(`plugin ${manifest.id} did not declare lane ${spec.id} in its manifest`);
        return subscriptions.add(lanes.register(spec, manifest.id));
      },
      open: (id) => lanes.open(id),
    },
    subscriptions,
  });

  const registry = new PluginRegistry({
    ...(options.apiVersion !== undefined ? { apiVersion: options.apiVersion } : {}),
    capabilities: OFFERED_CAPABILITIES,
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
    registry,
    commands,
    notices,
    midi,
    document,
    editor,
    query,
    notice,
    confirm,
    bindSession: (next) => {
      adapter = next;
    },
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
export { Slot, Panels } from "./slots";
export { LaneStore, LaneInput, laneFace } from "./lanes";
export type { LaneAdapter, LaneState, LaneOption, DeclaredLane } from "./lanes";
export { blockOfEvents } from "./queries";
export { toCommand } from "./messages";
export { HostMidiService, webMidiBackend, shellMidiBackend, noMidiBackend, detectMidiBackend, parseNoteMessage } from "./midi";
export type { MidiBackend } from "./midi";
export { MidiSink, NOTE_ON, NOTE_OFF } from "./midiSink";
export { ActionTable, rule, gate, modal, isMod } from "./actions";
export type { ActionStep, ActionRule, KeyEvent, Outcome } from "./actions";
export { confirmDialog, tauriInvoke } from "./shell";
