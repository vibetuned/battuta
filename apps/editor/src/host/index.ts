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
import { API_VERSION, DisposableStore, type ActivationEvent, type BlockSelection, type CommandMessage, type DocumentInfo, type DocumentQueries, type EditorState, type HostCapability, type PitchEvent, type PluginContext, type PluginEntry, type PluginManifest, type Store } from "@battuta/api";
import type { Command } from "@battuta/core";
import { toCommand } from "./messages";
import { keyMatches, type Layout } from "../keymap";
import { detectLayout } from "../settings";
import { KeymapStore } from "./keymapStore";
import { SlotStore, PanelStore } from "./slots";
import { CommandTable, PluginRegistry } from "./registry";
import { confirmDialog } from "./shell";
import { createStore, type WritableStore } from "./store";
import { isPluginEnabled, memorySettings, pluginSettings, pluginStorage, setPluginEnabled, webSettings, webStorage, type Notice, type SettingsIO, type StorageLike } from "./services";
import { BUILTIN_PLUGINS } from "./plugins";

/** Capabilities this host offers. Grows as services are lifted (slice 3: midi). */
export const OFFERED_CAPABILITIES: readonly HostCapability[] = [];

const IDLE_EDITOR: EditorState = { caret: null, selection: [], block: null, view: "tiles", entryMode: false };

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  code?: string;
}

/**
 * What the App binds for the active document: the executor (one undo
 * step, the same afterCommand as every core edit) and the answers to the
 * query facade. Null while no document is open.
 */
export interface SessionAdapter {
  execute(command: Command): void;
  pitchEventsIn(block: BlockSelection): PitchEvent[][];
  blockOf(eventIds: readonly string[]): BlockSelection | null;
}

export interface Host {
  readonly apiVersion: string;
  /** True when the URL carried ?plugins=off: nothing was registered. */
  readonly noPlugins: boolean;
  readonly keymap: KeymapStore;
  readonly slots: SlotStore;
  readonly panels: PanelStore;
  readonly registry: PluginRegistry;
  readonly commands: CommandTable;
  readonly notices: Store<Notice | null>;
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
}

export function createHost(options: HostOptions = {}): Host {
  const settings = options.settings ?? webSettings;
  const storage = options.storage ?? webStorage();
  const confirm = options.confirm ?? confirmDialog;
  const layout = options.layout ?? settings.load().layout ?? detectLayout();
  const noPlugins = options.noPlugins ?? false;

  const keymap = new KeymapStore(layout);
  const slots = new SlotStore();
  const panels = new PanelStore();
  const commands = new CommandTable();
  const notices = createStore<Notice | null>(null);
  let seq = 0;
  const notice = (text: string) => notices.set({ text, seq: ++seq });
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
  };

  const createContext = (manifest: PluginManifest, subscriptions: DisposableStore): PluginContext => ({
    manifest,
    apiVersion: options.apiVersion ?? API_VERSION,
    document,
    editor,
    query,
    execute,
    registerCommand: (id, handler) => subscriptions.add(commands.setHandler(id, manifest.id, handler)),
    notice,
    confirm,
    settings: pluginSettings(settings, manifest.id),
    storage: pluginStorage(storage, manifest.id),
    slots: { add: (slot, item) => subscriptions.add(slots.add(slot, item)) },
    panels: { open: (panel) => subscriptions.add(panels.open(panel)) },
    subscriptions,
  });

  const registry = new PluginRegistry({
    ...(options.apiVersion !== undefined ? { apiVersion: options.apiVersion } : {}),
    capabilities: OFFERED_CAPABILITIES,
    isEnabled: (id) => isPluginEnabled(settings, id),
    persistEnabled: (id, on) => setPluginEnabled(settings, id, on),
    contributeKeybindings: (pluginId, bindings) => keymap.contribute(pluginId, bindings),
    commands,
    createContext,
    report: notice,
  });

  if (!noPlugins) for (const entry of options.plugins ?? []) registry.register(entry);

  const dispatchKey = (e: KeyLike): boolean => {
    for (const [id, b] of Object.entries(keymap.get())) {
      if (!b.plugin || !keyMatches(b, e)) continue;
      void registry.runCommand(id);
      return true;
    }
    return false;
  };

  return {
    apiVersion: options.apiVersion ?? API_VERSION,
    noPlugins,
    keymap,
    slots,
    panels,
    registry,
    commands,
    notices,
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

/** The application's host. Built-in plugins registered; onStartup fired. */
export const host: Host = createHost({ noPlugins: detectNoPlugins(), plugins: BUILTIN_PLUGINS });
void host.fire("onStartup");
if (typeof window !== "undefined" && (import.meta.env.DEV || "__TAURI__" in window)) (window as unknown as Record<string, unknown>).__HOST__ = host;

export { memorySettings };
export type { PluginInfo, PluginState } from "./registry";
export { useStore } from "./store";
export { Slot, Panels } from "./slots";
export { blockOfEvents } from "./queries";
export { toCommand } from "./messages";
export { confirmDialog, tauriInvoke } from "./shell";
