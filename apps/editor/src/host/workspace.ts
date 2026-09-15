/**
 * The workspace host service (slice 9a, 2026-09-16): the folders the user
 * opened, read-only and SCOPED, behind one facade with two backends — the
 * shell's Tauri commands (`workspace_*` in main.rs, a `notify` watcher
 * emitting `workspace-change`) and a browser backend that reports itself
 * unavailable, so a plugin can say "the shell is required" and stop.
 *
 * Scoping is the shell's: only folders picked here (or re-admitted from a
 * plugin's persisted setting) can be listed, read or watched, and the
 * commands refuse everything outside them. This module owns the JS side:
 * routing watch events to the watch that asked, coalescing the bursts a
 * file save produces into one event per path, and the change stream the
 * host's own external-change guard listens to — a file open in a tab
 * that changes on disk under any watched folder is noticed at once.
 *
 * Opening a document is the App's (its one open path converts imports
 * and records the mtime), so `openDocument` goes through an adapter the
 * App binds, as the session and the view do.
 */
import { toDisposable, type DirEntry, type Disposable, type WatchEvent, type WatchEventKind, type WorkspaceService } from "@battuta/api";

/** What the shell offers: `invoke` for the commands, `listen` for its events. Null in a browser. */
export interface WorkspaceBridge {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  listen(event: string, cb: (e: { payload: unknown }) => void): Promise<() => void>;
}

/** What the App binds: opening a path through its open path (focus if already open, convert an import, record the mtime). */
export interface WorkspaceAdapter {
  openDocument(path: string): Promise<void>;
}

interface ChangePayload {
  id: number;
  path: string;
  kind: WatchEventKind;
}

interface WatchRecord {
  id: number | null;
  disposed: boolean;
  listener: (e: WatchEvent) => void;
  /** Per path, the timer that will deliver the coalesced event, and the last kind seen. */
  pending: Map<string, { timer: ReturnType<typeof setTimeout>; kind: WatchEventKind }>;
}

/** The global Tauri bridge when the page runs in the shell (withGlobalTauri), else null. */
export const detectWorkspaceBridge = (): WorkspaceBridge | null => {
  if (typeof window === "undefined") return null;
  const t = (window as unknown as { __TAURI__?: { event?: { listen?: WorkspaceBridge["listen"] }; core?: { invoke?: WorkspaceBridge["invoke"] } } }).__TAURI__;
  return t?.event?.listen && t.core?.invoke ? { listen: t.event.listen, invoke: t.core.invoke } : null;
};

export class HostWorkspaceService implements WorkspaceService {
  readonly available: boolean;
  private adapter: WorkspaceAdapter | null = null;
  private readonly watches = new Set<WatchRecord>();
  private readonly changeListeners = new Set<(e: WatchEvent) => void>();
  private listening: Promise<() => void> | null = null;

  constructor(
    private readonly bridge: WorkspaceBridge | null,
    /** A save is several filesystem events in a few ms; one per path is what a listener wants. */
    private readonly coalesceMs = 150,
  ) {
    this.available = bridge !== null;
  }

  bind(adapter: WorkspaceAdapter | null): void {
    this.adapter = adapter;
  }

  async pickFolder(): Promise<string | null> {
    if (!this.bridge) return null;
    const r = await this.bridge.invoke("workspace_pick_folder", {});
    return typeof r === "string" ? r : null;
  }

  async openFolder(path: string): Promise<boolean> {
    if (!this.bridge) return false;
    return (await this.bridge.invoke("workspace_open_folder", { path })) === true;
  }

  async readDir(path: string): Promise<DirEntry[]> {
    if (!this.bridge) throw new Error("the shell is required to read folders");
    return (await this.bridge.invoke("workspace_read_dir", { path })) as DirEntry[];
  }

  openDocument(path: string): Promise<void> {
    if (!this.adapter) return Promise.reject(new Error("no document opener is bound"));
    return this.adapter.openDocument(path);
  }

  watch(path: string, listener: (event: WatchEvent) => void): Disposable {
    if (!this.bridge) return toDisposable(() => undefined);
    const bridge = this.bridge;
    const rec: WatchRecord = { id: null, disposed: false, listener, pending: new Map() };
    this.watches.add(rec);
    this.ensureListening();
    const started = bridge.invoke("workspace_watch", { path }).then((id) => {
      if (typeof id !== "number") throw new Error(`workspace_watch answered ${JSON.stringify(id)}`);
      if (rec.disposed) void bridge.invoke("workspace_unwatch", { id }); // disposed before the shell answered
      else rec.id = id;
      return id;
    });
    started.catch(() => undefined);
    return toDisposable(() => {
      if (rec.disposed) return;
      rec.disposed = true;
      for (const p of rec.pending.values()) clearTimeout(p.timer);
      rec.pending.clear();
      this.watches.delete(rec);
      if (rec.id !== null) void bridge.invoke("workspace_unwatch", { id: rec.id });
    });
  }

  /** Every coalesced change from every active watch — the host's live external-change guard. */
  onChange(listener: (e: WatchEvent) => void): Disposable {
    this.changeListeners.add(listener);
    return toDisposable(() => this.changeListeners.delete(listener));
  }

  private ensureListening(): void {
    if (this.listening || !this.bridge) return;
    this.listening = this.bridge.listen("workspace-change", (e) => this.route(e.payload as ChangePayload));
    this.listening.catch(() => {
      this.listening = null;
    });
  }

  private route(payload: ChangePayload): void {
    if (!payload || typeof payload.path !== "string") return;
    for (const rec of this.watches) {
      if (rec.id !== payload.id || rec.disposed) continue;
      const prev = rec.pending.get(payload.path);
      if (prev) clearTimeout(prev.timer);
      const timer = setTimeout(() => {
        const last = rec.pending.get(payload.path);
        rec.pending.delete(payload.path);
        if (rec.disposed || !last) return;
        const event: WatchEvent = { path: payload.path, kind: last.kind };
        rec.listener(event);
        for (const l of [...this.changeListeners]) l(event);
      }, this.coalesceMs);
      rec.pending.set(payload.path, { timer, kind: payload.kind });
    }
  }
}
