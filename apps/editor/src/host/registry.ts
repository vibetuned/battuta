/**
 * The plugin registry: manifests in, activation on demand, deactivation
 * that is complete by construction.
 *
 * Registration validates the manifest, the API range and the required
 * capabilities; a plugin that fails stays LISTED (state "failed", with
 * the reason) so the Plugins tab can show it, but contributes nothing.
 * An enabled plugin's declarative contributions (commands, keybindings,
 * slot items) take effect at registration; its code loads on the first
 * activation event it declared — or when one of its keybindings is
 * pressed, or one of its declared slot items is clicked, both of which
 * fire `onCommand:<id>` implicitly.
 *
 * `load` is a dynamic import and resolves to a module NAMESPACE; the
 * registry unwraps the default export (`resolvePluginModule`).
 *
 * Turning a plugin off deactivates it (its `deactivate()` runs, then
 * every disposable it was handed fires) and withdraws its contributions:
 * bindings leave the keymap store, slot items and panels vanish. No
 * document change, no reload. The user's keymap overrides for its
 * bindings are untouched, so turning it back on restores them.
 */
import { API_VERSION, DisposableStore, resolvePluginModule, satisfiesEngine, toDisposable, validateManifest, type ActivationEvent, type CommandHandler, type Disposable, type HostCapability, type ExportContribution, type ImportContribution, type KeybindingContribution, type LaneContribution, type PluginContext, type PluginEntry, type PluginManifest, type PluginModule, type SlotItemContribution, type Store } from "@battuta/api";
import type { KeyBinding } from "../keymap";

/** The shape of a key event the host needs: what the App's handler and a test both provide. */
export interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  code?: string;
}

export type PluginState = "registered" | "active" | "disabled" | "failed";

export interface PluginInfo {
  readonly id: string;
  readonly manifest: PluginManifest;
  readonly state: PluginState;
  /** The user's switch (persisted). A failed plugin keeps the user's value but never runs. */
  readonly enabled: boolean;
  readonly error: string | null;
}

/** Command ids → owning plugin, and the handlers plugins register on activate. */
export class CommandTable {
  private readonly owners = new Map<string, string>();
  private readonly handlers = new Map<string, CommandHandler>();

  declare(commandId: string, pluginId: string): Disposable {
    const owner = this.owners.get(commandId);
    if (owner !== undefined && owner !== pluginId) throw new Error(`command ${commandId} is already declared by ${owner}`);
    this.owners.set(commandId, pluginId);
    return toDisposable(() => {
      if (this.owners.get(commandId) !== pluginId) return;
      this.owners.delete(commandId);
      this.handlers.delete(commandId);
    });
  }

  setHandler(commandId: string, pluginId: string, handler: CommandHandler): Disposable {
    if (this.owners.get(commandId) !== pluginId) throw new Error(`plugin ${pluginId} did not declare command ${commandId} in its manifest`);
    this.handlers.set(commandId, handler);
    return toDisposable(() => {
      if (this.handlers.get(commandId) === handler) this.handlers.delete(commandId);
    });
  }

  ownerOf(commandId: string): string | undefined {
    return this.owners.get(commandId);
  }

  /** Every declared command id (enabled plugins only, since contributions are withdrawn on off), in declaration order. */
  declared(): readonly string[] {
    return [...this.owners.keys()];
  }

  handlerOf(commandId: string): CommandHandler | undefined {
    return this.handlers.get(commandId);
  }
}

export interface RegistryDeps {
  /** Defaults to the API package's version; tests inject others. */
  apiVersion?: string;
  /** Capabilities this host offers (a manifest requiring another is refused). */
  capabilities: readonly HostCapability[];
  isEnabled(id: string): boolean;
  persistEnabled(id: string, on: boolean): void;
  contributeKeybindings(pluginId: string, bindings: KeybindingContribution[]): Disposable;
  /** Manifest-declared slot items: rendered by the host before the plugin's code loads. */
  declareSlotItems(pluginId: string, items: SlotItemContribution[]): Disposable;
  /** Manifest-declared lanes: listed in the status bar before the plugin's code loads. */
  declareLanes(pluginId: string, lanes: LaneContribution[]): Disposable;
  /** Manifest-declared exports: listed in the battuta menu before the plugin's code loads. */
  declareExports(pluginId: string, exports: ExportContribution[]): Disposable;
  /** Manifest-declared imports: their extensions are accepted by the open dialog before the plugin's code loads. */
  declareImports(pluginId: string, imports: ImportContribution[]): Disposable;
  commands: CommandTable;
  createContext(manifest: PluginManifest, subscriptions: DisposableStore, activatedBy: ActivationEvent | null): PluginContext;
  /** Where activation and command failures are reported (a notice in the app). */
  report(message: string): void;
  /** The host's key matcher (keymap.ts), so plugin bindings match exactly as core ones do. */
  keyMatches(b: KeyBinding, e: KeyLike): boolean;
}

interface PluginRecord {
  entry: PluginEntry;
  state: PluginState;
  enabled: boolean;
  error: string | null;
  module?: PluginModule;
  activating?: Promise<boolean>;
  /** Declarative contributions (bindings, command ownership). */
  contributions: DisposableStore;
  /** Everything handed out during activate(); disposed on deactivate. */
  subscriptions: DisposableStore;
}

export class PluginRegistry implements Store<readonly PluginInfo[]> {
  private readonly records = new Map<string, PluginRecord>();
  private snapshot: readonly PluginInfo[] = [];
  private readonly listeners = new Set<(p: readonly PluginInfo[]) => void>();
  private readonly apiVersion: string;

  constructor(private readonly deps: RegistryDeps) {
    this.apiVersion = deps.apiVersion ?? API_VERSION;
  }

  /** Arrow properties: safe to pass detached (React's useSyncExternalStore does). */
  readonly get = (): readonly PluginInfo[] => this.snapshot;

  readonly subscribe = (listener: (p: readonly PluginInfo[]) => void): Disposable => {
    this.listeners.add(listener);
    return toDisposable(() => this.listeners.delete(listener));
  };

  info(id: string): PluginInfo | undefined {
    return this.snapshot.find((p) => p.id === id);
  }

  register(entry: PluginEntry): PluginInfo {
    const m = entry.manifest;
    const problems = validateManifest(m);
    const id = typeof m?.id === "string" ? m.id : `invalid-${this.records.size}`;
    if (this.records.has(id)) problems.push(`duplicate plugin id ${id}`);
    if (problems.length === 0) {
      if (!satisfiesEngine(m.engines.battuta, this.apiVersion)) problems.push(`needs @battuta/api ${m.engines.battuta}, this host has ${this.apiVersion}`);
      for (const c of m.capabilities ?? []) if (!this.deps.capabilities.includes(c)) problems.push(`this host has no "${c}" capability`);
    }
    const rec: PluginRecord = {
      entry,
      state: problems.length ? "failed" : "registered",
      enabled: this.deps.isEnabled(id),
      error: problems.length ? problems.join("; ") : null,
      contributions: new DisposableStore(),
      subscriptions: new DisposableStore(),
    };
    this.records.set(id, rec);
    if (rec.state === "registered") {
      if (rec.enabled) this.applyContributions(rec);
      else rec.state = "disabled";
    }
    this.publish();
    return this.info(id)!;
  }

  /** Activate every enabled, not-yet-active plugin that declared this event. */
  async fire(event: ActivationEvent): Promise<void> {
    const targets = [...this.records.entries()].filter(([, r]) => r.enabled && r.state === "registered" && r.entry.manifest.activationEvents.includes(event));
    await Promise.all(targets.map(([id]) => this.activate(id, event)));
  }

  /** `activatedBy` is what the plugin's context reports as the reason it woke; null = started directly. */
  async activate(id: string, activatedBy: ActivationEvent | null = null): Promise<boolean> {
    const rec = this.records.get(id);
    if (!rec) return false;
    if (rec.activating) return rec.activating;
    if (rec.state !== "registered" || !rec.enabled) return rec.state === "active";
    rec.activating = (async () => {
      try {
        const mod = rec.module ?? resolvePluginModule(await rec.entry.load());
        rec.module = mod;
        rec.subscriptions = new DisposableStore();
        await mod.activate(this.deps.createContext(rec.entry.manifest, rec.subscriptions, activatedBy));
        rec.state = "active";
        return true;
      } catch (e) {
        rec.subscriptions.dispose();
        rec.state = "failed";
        rec.error = `activate failed: ${e instanceof Error ? e.message : String(e)}`;
        this.deps.report(`plugin ${id}: ${rec.error}`);
        return false;
      } finally {
        rec.activating = undefined;
        this.publish();
      }
    })();
    return rec.activating;
  }

  async deactivate(id: string): Promise<void> {
    const rec = this.records.get(id);
    if (!rec) return;
    if (rec.activating) await rec.activating;
    if (rec.state !== "active") return;
    try {
      await rec.module?.deactivate?.();
    } catch (e) {
      this.deps.report(`plugin ${id}: deactivate threw: ${e instanceof Error ? e.message : String(e)}`);
    }
    rec.subscriptions.dispose();
    rec.state = rec.enabled ? "registered" : "disabled";
    this.publish();
  }

  /** The Plugins tab switch. Off: deactivate + withdraw contributions. On: contribute again (and start if it wanted onStartup). */
  async setEnabled(id: string, on: boolean): Promise<void> {
    const rec = this.records.get(id);
    if (!rec || rec.enabled === on) return;
    rec.enabled = on;
    this.deps.persistEnabled(id, on);
    if (rec.error !== null && rec.state === "failed") {
      this.publish(); // the switch is remembered; a failed plugin still never runs
      return;
    }
    if (on) {
      rec.state = "registered";
      this.applyContributions(rec);
      this.publish();
      if (rec.entry.manifest.activationEvents.includes("onStartup")) await this.activate(id);
    } else {
      await this.deactivate(id);
      rec.contributions.dispose();
      rec.contributions = new DisposableStore();
      rec.state = "disabled";
      this.publish();
    }
  }

  /** A key against the plugins' contributed bindings: runs the owning command. False when none matches. */
  dispatchKeyFor(keymap: { get(): Record<string, KeyBinding> }, e: KeyLike): boolean {
    for (const [id, b] of Object.entries(keymap.get())) {
      if (!b.plugin || !this.deps.keyMatches(b, e)) continue;
      void this.runCommand(id);
      return true;
    }
    return false;
  }

  /** Run a plugin command by id, loading its owner first if needed. False when no plugin owns it. */
  async runCommand(commandId: string, args?: unknown): Promise<boolean> {
    const owner = this.deps.commands.ownerOf(commandId);
    if (owner === undefined) return false;
    let handler = this.deps.commands.handlerOf(commandId);
    if (!handler) {
      await this.activate(owner, `onCommand:${commandId}`);
      handler = this.deps.commands.handlerOf(commandId);
    }
    if (!handler) {
      const rec = this.records.get(owner);
      if (rec?.state !== "failed") this.deps.report(`plugin ${owner} declared ${commandId} but registered no handler for it`);
      return true;
    }
    try {
      await handler(args);
    } catch (e) {
      this.deps.report(`${commandId} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return true;
  }

  /** Deactivate everything and withdraw all contributions (tests, hot reload). */
  async dispose(): Promise<void> {
    for (const id of this.records.keys()) await this.deactivate(id);
    for (const rec of this.records.values()) rec.contributions.dispose();
    this.records.clear();
    this.publish();
  }

  private applyContributions(rec: PluginRecord): void {
    const m = rec.entry.manifest;
    try {
      for (const c of m.contributes?.commands ?? []) rec.contributions.add(this.deps.commands.declare(c.id, m.id));
      const bindings = m.contributes?.keybindings ?? [];
      if (bindings.length) rec.contributions.add(this.deps.contributeKeybindings(m.id, bindings));
      const slotItems = m.contributes?.slotItems ?? [];
      if (slotItems.length) rec.contributions.add(this.deps.declareSlotItems(m.id, slotItems));
      const lanes = m.contributes?.lanes ?? [];
      if (lanes.length) rec.contributions.add(this.deps.declareLanes(m.id, lanes));
      const exports = m.contributes?.exports ?? [];
      if (exports.length) rec.contributions.add(this.deps.declareExports(m.id, exports));
      const imports = m.contributes?.imports ?? [];
      if (imports.length) rec.contributions.add(this.deps.declareImports(m.id, imports));
    } catch (e) {
      rec.contributions.dispose();
      rec.contributions = new DisposableStore();
      rec.state = "failed";
      rec.error = e instanceof Error ? e.message : String(e);
    }
  }

  private publish(): void {
    this.snapshot = [...this.records.entries()].map(([id, r]) => ({ id, manifest: r.entry.manifest, state: r.state, enabled: r.enabled, error: r.error }));
    for (const l of [...this.listeners]) l(this.snapshot);
  }
}
